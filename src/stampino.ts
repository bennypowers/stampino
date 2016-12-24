import * as idom from 'incremental-dom';
import { Parser, EvalAstFactory, Expression } from 'polymer-expressions';

const astFactory = new EvalAstFactory();

const toCamelCase = (s: string) => s.replace(/-(\w)/, (_, p1) => p1.toUppercase());

/**
 * incremental-dom attribute handler that sets properties on elements by
 * default and calls setAttribute if the attribtue name ends in `$`.
 */
idom.attributes.__default = function(element: Element, name: string, value: any) {
  if (name.endsWith('$')) {
    name = name.substring(0, name.length - 1);
    element.setAttribute(name, value);
  } else {
    element[toCamelCase(name)] = value;
  }
};

const _expressionCache = new WeakMap<Node, Expression>();

/**
 * Returns the value of a text node or attribute, evaluating it as an expression
 * if the value starts with `{{` and ends with `}}`.
 */
export function getValue(node: Text|Attr, model: any): any {
  let ast = _expressionCache.get(node);
  if (ast) {
    return ast.evaluate(model);
  }
  const value = node.textContent;
  if (value == null) return null;
  if (value.startsWith('{{') && value.endsWith('}}')) {
    const expression = value.substring(2, value.length - 2).trim();
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

export type Renderer = (context: RenderContext) => void;

export type Handler = (template: HTMLTemplateElement, context: RenderContext) => void;

export const ifHandler: Handler = (template, context) => {
  const ifAttribute = template.getAttributeNode('if');
  if (ifAttribute && getValue(ifAttribute, context.model)) {
    renderNode(template.content, context);
  }
};

export const repeatHandler: Handler = (template, context) => {
  const repeatAttribute = template.getAttributeNode('repeat');
  if (repeatAttribute) {
    const items = getValue(repeatAttribute, context.model);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      // TODO: provide keys to incremental-dom
      const itemModel = Object.create(context.model);
      itemModel.item = item;
      itemModel.index = index;
      // itemModel['this'] = model['this'] || model;
      const itemContext = {
        ...context,
        model: itemModel,
      }
      renderNode(template.content, itemContext);
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
      const renderer: Renderer = (context) => renderNode(block.content, context);
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
  if (template == null) {
    throw new Error('null template');
  }
  handlers = handlers || defaultHandlers;
  renderers = renderers || new Map();

  if (superTemplate) {
    const superNode = template.content.querySelector('[name=super]') as HTMLTemplateElement;
    if (superNode) {
      const superRenderers = getRenderers(superNode);
      const superRenderer: Renderer = (context) =>
          renderNode(superTemplate.content, {
            ...context,
            renderers: superRenderers,
          });
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

  return (model) => renderNode(template.content, {model, renderers: renderers!, handlers: handlers!, attributeHandler});
}

export interface RenderOptions {
  attributeHandler?: AttributeHandler;
  renderers: Map<string, Renderer>;
  handlers: Map<string, Handler>;
  extends?: HTMLTemplateElement;
}

export interface RenderContext {
  model: any;
  renderers: Map<string, Renderer>;
  handlers: Map<string, Handler>;
  attributeHandler?: AttributeHandler;
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

export function renderNode(node: Node, context: RenderContext) {
  
  switch (node.nodeType) {
    // We encounter DocumentFragments when we recurse into a nested template
    // while processing directives and blocks.
    case Node.DOCUMENT_FRAGMENT_NODE:
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        renderNode(children[i], context);
      }
      break;
    case Node.ELEMENT_NODE:
      const element = node as Element;
      if (element.tagName === 'TEMPLATE') {
        const template = element as HTMLTemplateElement;
        // Handle template types, like: 'if' and 'repeat'
        const typeAttribute = element.getAttribute('type');
        if (typeAttribute) {
          const handler = context.handlers.get(typeAttribute);
          if (handler) {
            handler(template, context);
          } else {
            console.warn('No handler for template type', typeAttribute);
            return;
          }
        }
        // Handle named holes
        const nameAttribute = element.getAttribute('name');
        if (nameAttribute) {
          let renderer = context.renderers.get(nameAttribute);
          if (renderer) {
            // TS revealed a type error here:
            renderer(context);
            // renderer(template, model, renderers, handlers, attributeHandler);
            return;
          }
          // if there's no named renderer, render the default content
          renderNode(template.content, context);
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
          if (context.attributeHandler && context.attributeHandler.matches(attr.name)) {
            handledAttributes.push(attr);
          } else {
            // TODO: if attribute is a literal, add it to statics instead
            propertyValuePairs.push(attr.name);
            propertyValuePairs.push(getValue(attr, context.model));
          }
        }
        const tagName = element.tagName.toLowerCase();
        const el = idom.elementOpen(tagName, undefined, undefined, ...propertyValuePairs);

        // TODO: why do this as a batch after element open? It changes expression
        // evaluation order, which is a nice property to preserve!
        for (let i = 0; i < handledAttributes.length; i++) {
          const attr = handledAttributes[i];
          context.attributeHandler!.handle(el, attr.name, attr.value, context.model);
        }

        const children = node.childNodes;
        for (let i = 0; i < children.length; i++) {
          renderNode(children[i], context);
        }
        idom.elementClose(element.tagName);
      }
      break;
    case Node.TEXT_NODE:
      const value = getValue(node as Text, context.model);
      idom.text(value);
      break;
    case Node.COMMENT_NODE:
      break;
    default:
      console.warn('unhandled node type', node.nodeType);
  }
}
