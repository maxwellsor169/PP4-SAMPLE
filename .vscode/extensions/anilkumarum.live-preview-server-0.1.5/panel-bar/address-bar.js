const $on = (target, type, callback) => target.addEventListener(type, callback),
	eId = document.getElementById.bind(document);
let port = "2200";
const vscode = acquireVsCodeApi();
window.addEventListener("message", (event) => {
	const message = event.data;
	if (message.type === "completionList") return showPathSuggestion(message.dirListings);
	if (message.command === "passConsole") vscode.postMessage(event.data);
});

window.addEventListener("keyup", (event) => {
	event.key === "F12" && vscode.postMessage({ command: "openDevTools" });
});

/**@type {HTMLIFrameElement} */
const hostedContent = eId("hostedContent");

const historyStack = [];
let pageIdx = -1;
let willPush = true;
const elem = {
	/**@type {HTMLInputElement} */
	addressInput: null,
	/**@type {HTMLButtonElement} */
	backBtn: null,
	/**@type {HTMLButtonElement} */
	forwardBtn: null,
	/**@type {HTMLMenuElement} */
	suggestionList: null,
};

function goBack() {
	willPush = false;
	const prevPageUrl = historyStack.at(--pageIdx);
	prevPageUrl && (hostedContent.src = prevPageUrl);
}

function goFoward() {
	willPush = false;
	const nxtPageUrl = historyStack.at(++pageIdx);
	nxtPageUrl && (hostedContent.src = nxtPageUrl);
}

function reload() {
	willPush = false;
	hostedContent.src = hostedContent.src;
}

function goToUrl({ target }) {
	hostedContent.src = "http://localhost:" + port + target.value;
}

hostedContent.onload = function () {
	const pageUrl = hostedContent.src;
	if (willPush) {
		historyStack.push(pageUrl);
		++pageIdx;
	} else willPush = true;
	elem.addressInput.value = new URL(pageUrl).pathname;
	elem.forwardBtn.disabled = pageIdx === historyStack.length;
	elem.backBtn.disabled = pageIdx < 0;
};
hostedContent.onerror = (err) => console.error(err);

export class AddressBar extends HTMLElement {
	constructor() {
		super();
	}

	render() {
		return `<button id="back" title="Back" class="back-button">
		<svg class="back" viewBox="0 0 24 24">
			<path></path>
		</svg>
	</button>
	<button id="forward" title="Forward" class="forward-button" tabindex="0">
		<svg class="forward" viewBox="0 0 24 24">
			<path></path>
		</svg>
	</button>
	<button id="reload" title="Reload" class="reload-button" tabindex="0">
		<svg class="reload" viewBox="0 0 24 24">
			<path></path>
		</svg>
	</button>
	<input id="url-input" type="text" value="http://localhost:${port}" disabled />
	<label class="input-box">
		<input id="url-input" class="url-input" type="url"pattern="^/[/.a-zA-Z0-9-]+$" />
		<menu id="path-suggestions" hidden></menu>
	</label>
	<details>
		<summary id="more" title="More Browser Actions" class="more-button icon">
			<svg class="menu" viewBox="0 0 24 24">
					<path></path>
			</svg>
		</summary>
		<menu>
			<li id="open_dev_ools">Open Dev Tools</li>
		</menu>
	</details>
	`;
	}

	connectedCallback() {
		port = this.getAttribute("port") || "2200";
		this.innerHTML = this.render();
		elem.backBtn = this.firstElementChild;
		elem.forwardBtn = this.children[1];
		elem.addressInput = this.children[4].firstElementChild;

		$on(elem.backBtn, "click", goBack);
		$on(elem.forwardBtn, "click", goFoward);
		$on(this.children[2], "click", reload);
		// $on(elem.addressInput, "change", goToUrl);

		elem.suggestionList = eId("path-suggestions");
		$on(elem.addressInput, "mouseup", reqSuggestionList.bind(null, null));
		$on(elem.addressInput, "input", filterSuggestion);
		$on(elem.addressInput, "blur", () => (elem.suggestionList.hidden = true));
		$on(elem.addressInput, "keyup", (event) => event.key === "Enter" && goToUrl(event));
		$on(elem.suggestionList, "mousedown", acceptSuggestionPath);
		$on(eId("open_dev_ools"), "click", openDevTools);

		elem.addressInput.value = "/src"; //temp
	}
}

function reqSuggestionList(dirPath) {
	const range = getCurPathRange();
	dirPath ??= elem.addressInput.value.slice(0, range.start);
	vscode.postMessage({ command: "sendDirListing", dirPath });
}

function compltItem(path) {
	return `<li>
		<svg class="${path.isDirectory ? "folder" : "file"}" viewBox="0 0 24 24">
			<path></path>
		</svg>
		<span ${path.isDirectory ? "isdir=''" : ""}>${path.name}</span>
	</li>`;
}

function createPathList(dirList) {
	const itemsStr = dirList.map(compltItem).join("");
	const docFrag = document.createRange().createContextualFragment(itemsStr);
	return docFrag;
}

let enterTxt = null;
let showSuggestion;
/**@param {{name:string,isDirectory:boolean}[]} dirListings*/
function showPathSuggestion(dirListings) {
	//set input selection
	const range = getCurPathRange();
	if (!showSuggestion) {
		elem.suggestionList.hidden = false;
		elem.suggestionList.style.left = elem.addressInput.selectionEnd - 4 + "ch";
		elem.suggestionList.replaceChildren(createPathList(dirListings));
		elem.addressInput.setSelectionRange(range.start, range.end);
	}
	showSuggestion = !showSuggestion;
	enterTxt = "";
}

function filterSuggestion({ data }) {
	if (data === "/") return reqSuggestionList();
	data ? (enterTxt += data) : (enterTxt = enterTxt.slice(0, -1));

	for (const path of elem.suggestionList.children) {
		path["hidden"] = !path.lastElementChild.textContent.startsWith(enterTxt);
	}
	elem.suggestionList.hidden = !elem.suggestionList.querySelector("li:not([hidden])");
}

function acceptSuggestionPath({ target }) {
	/**@type {HTMLSpanElement} */
	const spanTarget =
		target.tagName === "SPAN"
			? target
			: target.tagName === "LI"
			? target.firstElementChild
			: target.nextElementSibling;
	let text = spanTarget.textContent.trim();
	const range = getCurPathRange();
	const hasSlash = elem.addressInput.value[range.end] === "/";
	const isFolder = spanTarget.hasAttribute("isdir");
	if (isFolder && !hasSlash) text += "/";
	elem.addressInput.setRangeText(text, range.start, range.end);
	if (isFolder) {
		let dirPath = elem.addressInput.value.slice(0, range.end);
		dirPath.endsWith("/") && (dirPath = dirPath.slice(0, -1));
		reqSuggestionList(dirPath);
		//TODO automate / suggestion trigger
	} else showSuggestion = false;
}

const CharCode = {
	Dot: 46, //.
	Slash: 0x2f, // /
};

function getCurPathRange() {
	const curPos = elem.addressInput.selectionEnd;
	const pathText = elem.addressInput.value;
	const length = pathText.length;
	let i = curPos;

	const range = { start: null, end: length };
	while (i--) {
		if (pathText.charCodeAt(i) === CharCode.Slash) {
			range.start = i + 1;
			break;
		}
	}

	for (let index = curPos; index < length; index++) {
		if (pathText.charCodeAt(index) === CharCode.Slash) {
			range.end = index;
			break;
		}
	}
	return range;
}

function openDevTools({ target }) {
	vscode.postMessage({ command: "openDevTools" });
	target.closest("details").open = false;
}

customElements.define("address-bar", AddressBar);
