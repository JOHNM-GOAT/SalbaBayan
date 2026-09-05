/**
 * Artboard runtime.
 *
 * Every `.dc.html` in this folder references this file but it was never
 * committed, so opening an artboard in a plain browser showed raw `{{...}}`
 * placeholders and the PNGs could only be produced by hand. This restores the
 * small amount of behaviour the canvas editor provides, so the artboards are
 * self-contained: openable, tweakable, and re-renderable by anyone with a
 * browser.
 *
 * It implements three things and nothing more:
 *   - `DCLogic`, the base class each artboard's `Component` extends
 *   - `{{path.to.value}}` substitution in text and attributes
 *   - `<sc-if value="...">`, which keeps its children only when truthy
 *
 * Props come from the `data-props` defaults, and any of them can be overridden
 * from the query string (`?signal=5&lang=Cebuano`) — which is what lets one
 * artboard be exported at several states.
 */

class DCLogic {
  constructor(props) {
    this.props = props || {};
  }
  renderVals() {
    return {};
  }
}
window.DCLogic = DCLogic;

(function () {
  const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

  /** Resolve `a.b.c` against the values object. Missing paths render empty. */
  function lookup(values, path) {
    return path
      .split(".")
      .reduce((acc, key) => (acc == null ? undefined : acc[key]), values);
  }

  function substitute(text, values) {
    return text.replace(PLACEHOLDER, (_, path) => {
      const value = lookup(values, path.trim());
      return value === undefined || value === null ? "" : String(value);
    });
  }

  /**
   * `<sc-if>` is resolved before substitution, because its own `value`
   * attribute is itself a placeholder. Truthiness follows the obvious reading:
   * empty string, "false", "0" and absent all count as false.
   */
  function resolveConditionals(root, values) {
    for (const node of Array.from(root.querySelectorAll("sc-if"))) {
      const raw = substitute(node.getAttribute("value") || "", values).trim();
      const keep = raw !== "" && raw !== "false" && raw !== "0";
      if (keep) node.replaceWith(...Array.from(node.childNodes));
      else node.remove();
    }
  }

  function substituteTree(root, values) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue.includes("{{")) {
          node.nodeValue = substitute(node.nodeValue, values);
        }
      } else {
        for (const attr of Array.from(node.attributes || [])) {
          if (attr.value.includes("{{")) {
            node.setAttribute(attr.name, substitute(attr.value, values));
          }
        }
      }
    }
  }

  function readProps(script) {
    const props = {};
    let spec = {};
    try {
      spec = JSON.parse(script.dataset.props || "{}");
    } catch {
      spec = {};
    }
    for (const [key, config] of Object.entries(spec)) {
      if (config && typeof config === "object" && "default" in config) {
        props[key] = config.default;
      }
    }
    // Query-string overrides let one artboard be exported at several states.
    for (const [key, value] of new URLSearchParams(location.search)) {
      props[key] = value;
    }
    return props;
  }

  function boot() {
    const stage = document.querySelector("x-dc");
    if (!stage) return;

    // The <helmet> block carries the artboard's fonts and CSS. Move it into
    // <head> so those apply to the document rather than sitting inert.
    const helmet = stage.querySelector("helmet");
    if (helmet) {
      document.head.append(...Array.from(helmet.childNodes));
      helmet.remove();
    }

    const script = document.querySelector("script[data-dc-script]");
    let values = {};
    if (script && typeof Component !== "undefined") {
      try {
        values = new Component(readProps(script)).renderVals() || {};
      } catch (error) {
        console.error("renderVals() failed:", error);
      }
    }

    resolveConditionals(stage, values);
    substituteTree(stage, values);
    document.documentElement.dataset.dcReady = "true";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
