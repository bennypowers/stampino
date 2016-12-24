import * as idom from 'incremental-dom';
import { Parser, EvalAstFactory, Expression } from 'polymer-expressions';

const astFactory = new EvalAstFactory();

const toCamelCase = (s: string) => s.replace(/-(\w)/, (_, p1) => p1.toUppercase());

idom.attributes.__default = function(element: Element, name: string, value: any) {
  if (name.endsWith('$')) {
    name = name.substring(0, name.length - 1);
    element.setAttribute(name, value);
  } else {
    element[toCamelCase(name)] = value;
  }
};

const _expressionCache = new WeakMap<Node, Expression>();

export function getValue(node: Node, model: any): any {
  let ast = _expressionCache.get(node);
  if (ast) {
    return ast.evaluate(model);
  }
  const value = node.textContent;
  if (value == null) return null;
  if (value.startsWith('{{') && value.endsWith('}}')) {
    let expression = value.substring(2, value.length - 2).trim();
    ast = <Expression>(new Parser(expression, astFactory).parse());
    _expressionCache.set(node, ast);
    return ast.evaluate(model);
  }
  if (value.startsWith('\\{{')) {
    return value.substring(1);
  }
  return value;
}

export interface TemplateUpdater {
  (model: any): void;
}

export interface AttributeHandler {
  matches(name: string): boolean;
  handle(el: Element, name: string, value: any, model: any): void;
}

// export interface Renderers {
//   [name: string]: Renderer;
// }

export interface Renderer {
  (model: any, renderers: Map<string, Renderer>, handlers: Map<string, Handler>,
    attributeHandler?: AttributeHandler): void;
}

export interface Handler {
  (template: HTMLTemplateElement, model: any, renderers: Map<string, Renderer>,
    handlers: Map<string, Handler>, attributeHandler?: AttributeHandler): void;
}

// export interface Map<string, Handler> {
//   [name: string]: Handler;
// }

export const ifHandler: Handler = (template, model, renderers, handlers, attributeHandler) => {
  const ifAttribute = template.getAttributeNode('if');
  if (ifAttribute && getValue(ifAttribute, model)) {
    renderNode(template.content, model, renderers, handlers, attributeHandler);
  }
};

export const repeatHandler: Handler = (template, model, renderers, handlers, attributeHandler) => {
  const repeatAttribute = template.getAttributeNode('repeat');
  if (repeatAttribute) {
    const items = getValue(repeatAttribute, model);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      // TODO: provide keys to incremental-dom
      const itemModel = Object.create(model);
      itemModel.item = item;
      itemModel.index = index;
      // itemModel['this'] = model['this'] || model;
      renderNode(template.content, itemModel, renderers, handlers, attributeHandler);
    }
  }
};

export const defaultHandlers = new Map([['if', ifHandler], ['repeat', repeatHandler]]);

function getRenderers(template: HTMLTemplateElement): Map<string, Renderer> {
  const blocks = <NodeListOf<HTMLTemplateElement>>
    template.content.querySelectorAll('template[name]');
  const renderers = new Map<string, Renderer>();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const name = block.getAttribute('name')!;
    if (name !== 'super') {
      const renderer: Renderer = (model, renderers, handlers, attributeHandler) =>
          renderNode(block.content, model, renderers, handlers, attributeHandler);
      renderers.set(name, renderer);
    }
  }
  return renderers;
}

/**
 * Performs one-time setup of a template element to convert to an
 * increment-dom render function.
 * 
 * @returns a render function that can be passed to incremental-dom's
 * patch() function.
 */
export function prepareTemplate(
    template: HTMLTemplateElement,
    renderers?: Map<string, Renderer>,
    handlers?: Map<string, Handler>,
    attributeHandler?: AttributeHandler,
    superTemplate?: HTMLTemplateElement): TemplateUpdater {
  handlers = handlers || defaultHandlers;
  renderers = renderers || new Map();

  if (superTemplate) {
    const superNode = template.content.querySelector('[name=super]') as HTMLTemplateElement;
    if (superNode) {
      const superRenderers = getRenderers(superNode);
      const superRenderer: Renderer = (model, renderers, handlers, attributeHandler) =>
          renderNode(superTemplate.content, model, superRenderers, handlers,
              attributeHandler);
      renderers = new Map([['super', superRenderer]]);
    } else {
      // Wrap the whole template in an implicit super call: immediately render
      // the super template, with all renderers from this template
      const templateRenderers = getRenderers(template);
      for (const entry of renderers) {
        templateRenderers.set(entry[0], entry[1]);
      }
      renderers = templateRenderers;
      template = superTemplate;
    }
  }

  return (model) => renderNode(template.content, model, renderers!, handlers!,
      attributeHandler);
}

export interface RenderOptions {
  attributeHandler?: AttributeHandler;
  renderers: Map<string, Renderer>;
  handlers: Map<string, Handler>;
  extends?: HTMLTemplateElement;
}

/**
 * Renders a template element containing a Stampino template.
 *
 * This version interprets the template by walking its content and invoking
 * incremental-dom calls for each node, and evaluating Polymer expressions
 * contained within {{ }} blocks.
 *
 * As an optimization we can compile templates into a list of objects that
 * directly translate to incremental-dom calls, and includes pre-parsed
 * expressions. We won't optimize until we have benchmarks in place however.
 */
export function render(
    template: HTMLTemplateElement,
    container: Element,
    model: any,
    opts?: Partial<RenderOptions>) {
  opts = opts || {};
  const _render = prepareTemplate(template, opts!.renderers, opts!.handlers,
      opts!.attributeHandler, opts!.extends);
  idom.patch(container, _render, model);
}

export function renderNode(
    node: Node,
    model: any,
    renderers: Map<string, Renderer>,
    handlers: Map<string, Handler>,
    attributeHandler?: AttributeHandler) {
  
  switch (node.nodeType) {
    // We encounter DocumentFragments when we recurse into a nested template
    // while processing directives and blocks.
    case Node.DOCUMENT_FRAGMENT_NODE:
      let children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        renderNode(children[i], model, renderers, handlers, attributeHandler);
      }
      break;
    case Node.ELEMENT_NODE:
      let element = <Element>node;
      if (element.tagName.toLowerCase() === 'template') {
        let template = <HTMLTemplateElement>element;
        // Handle template types, like: 'if' and 'repeat'
        let typeAttribute = element.getAttribute('type');
        if (typeAttribute) {
          let handler = handlers.get(typeAttribute);
          if (handler) {
            handler(template, model, renderers, handlers, attributeHandler);
          } else {
            console.warn('No handler for template type', typeAttribute);
            return;
          }
        }
        // Handle named holes
        const nameAttribute = element.getAttribute('name');
        if (nameAttribute) {
          if (renderers) {
            let renderer = renderers.get(nameAttribute);
            if (renderer) {
              // TS revealed a type error here:
              renderer(model, renderers, handlers, attributeHandler);
              // renderer(template, model, renderers, handlers, attributeHandler);
              return;
            }
          }
          // if there's no named renderer, render the default content
          renderNode(template.content, model, renderers, handlers, attributeHandler);
          return;
        }
        // by default, templates are not rendered
      } else {
        // elementOpen has a weird API. It takes varargs of alternating
        // attribute name/value pairs
        const propertyValuePairs: any[] = [];
        const attributes = element.attributes;
        const handledAttributes = <Attr[]>[];
        for (let i = 0; i < attributes.length; i++) {
          const attr = attributes[i];
          if (attributeHandler && attributeHandler.matches(attr.name)) {
            handledAttributes.push(attr);
          } else {
            // TODO: if attribute is a literal, add it to statics instead
            propertyValuePairs.push(attr.name);
            propertyValuePairs.push(getValue(attr, model));
          }
        }
        const tagName = element.tagName.toLowerCase();
        const el = idom.elementOpen(tagName, undefined, undefined, ...propertyValuePairs);

        // TODO: why do this as a batch after element open? It changes expression
        // evaluation order, which is a nice property to preserve!
        for (let i = 0; i < handledAttributes.length; i++) {
          const attr = handledAttributes[i];
          if (attributeHandler) {
            attributeHandler.handle(el, attr.name, attr.value, model);
          }
        }

        let children = node.childNodes;
        for (let i = 0; i < children.length; i++) {
          renderNode(children[i], model, renderers, handlers, attributeHandler);
        }
        idom.elementClose(element.tagName);
      }
      break;
    case Node.TEXT_NODE:
      let value = getValue(node, model);
      idom.text(value);
      break;
    case Node.COMMENT_NODE:
      break;
    default:
      console.warn('unhandled node type', node.nodeType);
  }
}
