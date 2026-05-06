import { translateText, type Language } from "./messages";

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "alt", "placeholder", "title"] as const;
const SKIP_SELECTOR = [
  "script",
  "style",
  "pre",
  "code",
  "textarea",
  "[contenteditable='true']",
  "[data-i18n-skip]",
  ".monaco-editor",
  ".prose",
  ".xterm",
].join(",");

const textOriginals = new WeakMap<Text, string>();
const textApplied = new WeakMap<Text, string>();
const attrOriginals = new WeakMap<Element, Map<string, string>>();
const attrApplied = new WeakMap<Element, Map<string, string>>();

let observer: MutationObserver | null = null;
let currentLanguage: Language = "en";
let applying = false;

function shouldSkipElement(element: Element | null) {
  return Boolean(element?.closest(SKIP_SELECTOR));
}

function translateTextNode(node: Text) {
  if (shouldSkipElement(node.parentElement)) return;

  const current = node.data;
  const last = textApplied.get(node);
  let original = textOriginals.get(node);

  if (original === undefined || (last !== undefined && current !== last)) {
    original = current;
    textOriginals.set(node, original);
  }

  const next = translateText(original, currentLanguage);
  textApplied.set(node, next);

  if (current !== next) {
    node.data = next;
  }
}

function getAttrMap(map: WeakMap<Element, Map<string, string>>, element: Element) {
  let values = map.get(element);
  if (!values) {
    values = new Map();
    map.set(element, values);
  }
  return values;
}

function translateAttribute(element: Element, attr: (typeof TRANSLATABLE_ATTRIBUTES)[number]) {
  if (shouldSkipElement(element)) return;

  const current = element.getAttribute(attr);
  if (!current) return;

  const originals = getAttrMap(attrOriginals, element);
  const applied = getAttrMap(attrApplied, element);
  const last = applied.get(attr);
  let original = originals.get(attr);

  if (original === undefined || (last !== undefined && current !== last)) {
    original = current;
    originals.set(attr, original);
  }

  const next = translateText(original, currentLanguage);
  applied.set(attr, next);

  if (current !== next) {
    element.setAttribute(attr, next);
  }
}

function translateElementAttributes(element: Element) {
  for (const attr of TRANSLATABLE_ATTRIBUTES) {
    translateAttribute(element, attr);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text);
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

  const element = root.nodeType === Node.ELEMENT_NODE ? root as Element : null;
  if (shouldSkipElement(element)) return;

  if (element) translateElementAttributes(element);
  root.childNodes.forEach(walk);
}

function translateDocument() {
  if (!document.body) return;
  applying = true;
  try {
    walk(document.body);
  } finally {
    applying = false;
  }
}

export function refreshDomTranslations(language: Language) {
  currentLanguage = language;
  translateDocument();
}

export function installDomTranslations(language: Language) {
  currentLanguage = language;
  translateDocument();

  if (observer || !document.body) return;

  observer = new MutationObserver((mutations) => {
    if (applying) return;
    applying = true;
    try {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          translateTextNode(mutation.target as Text);
          continue;
        }

        if (mutation.type === "attributes") {
          const attr = mutation.attributeName as (typeof TRANSLATABLE_ATTRIBUTES)[number] | null;
          if (attr && TRANSLATABLE_ATTRIBUTES.includes(attr)) {
            translateAttribute(mutation.target as Element, attr);
          }
          continue;
        }

        mutation.addedNodes.forEach(walk);
      }
    } finally {
      applying = false;
    }
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    characterData: true,
    childList: true,
    subtree: true,
  });
}
