define("stampino", ["require", "exports", "incremental-dom", "polymer-expressions"], function (require, exports, idom, polymer_expressions_1) {
    "use strict";
    const astFactory = new polymer_expressions_1.EvalAstFactory();
    const toCamelCase = (s) => s.replace(/-(\w)/, (_, p1) => p1.toUppercase());
    idom.attributes.__default = function (element, name, value) {
        if (name.endsWith('$')) {
            name = name.substring(0, name.length - 1);
            element.setAttribute(name, value);
        }
        else {
            element[toCamelCase(name)] = value;
        }
    };
    const _expressionCache = new WeakMap();
    function getValue(node, model) {
        let ast = _expressionCache.get(node);
        if (ast) {
            return ast.evaluate(model);
        }
        const value = node.textContent;
        if (value == null)
            return null;
        if (value.startsWith('{{') && value.endsWith('}}')) {
            let expression = value.substring(2, value.length - 2).trim();
            ast = (new polymer_expressions_1.Parser(expression, astFactory).parse());
            _expressionCache.set(node, ast);
            return ast.evaluate(model);
        }
        if (value.startsWith('\\{{')) {
            return value.substring(1);
        }
        return value;
    }
    exports.getValue = getValue;
    // export interface Map<string, Handler> {
    //   [name: string]: Handler;
    // }
    exports.ifHandler = (template, model, renderers, handlers, attributeHandler) => {
        const ifAttribute = template.getAttributeNode('if');
        if (ifAttribute && getValue(ifAttribute, model)) {
            renderNode(template.content, model, renderers, handlers, attributeHandler);
        }
    };
    exports.repeatHandler = (template, model, renderers, handlers, attributeHandler) => {
        const repeatAttribute = template.getAttributeNode('repeat');
        if (repeatAttribute) {
            const items = getValue(repeatAttribute, model);
            for (let index = 0; index < items.length; index++) {
                let item = items[index];
                // TODO: provide keys to incremental-dom
                const itemModel = Object.create(model);
                itemModel.item = item;
                itemModel.index = index;
                itemModel['this'] = model['this'] || model;
                renderNode(template.content, itemModel, renderers, handlers, attributeHandler);
            }
        }
    };
    exports.defaultHandlers = new Map([['if', exports.ifHandler], ['repeat', exports.repeatHandler]]);
    function getRenderers(template) {
        const blocks = template.content.querySelectorAll('template[name]');
        const renderers = new Map();
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const name = block.getAttribute('name');
            if (name !== 'super') {
                const renderer = (model, renderers, handlers, attributeHandler) => renderNode(block.content, model, renderers, handlers, attributeHandler);
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
    function prepareTemplate(template, renderers, handlers, attributeHandler, superTemplate) {
        handlers = handlers || exports.defaultHandlers;
        renderers = renderers || new Map();
        if (superTemplate) {
            const superNode = template.content.querySelector('[name=super]');
            if (superNode) {
                const superRenderers = getRenderers(superNode);
                const superRenderer = (model, renderers, handlers, attributeHandler) => renderNode(superTemplate.content, model, superRenderers, handlers, attributeHandler);
                renderers = new Map([['super', superRenderer]]);
            }
            else {
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
        return (model) => renderNode(template.content, model, renderers, handlers, attributeHandler);
    }
    exports.prepareTemplate = prepareTemplate;
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
    function render(template, container, model, opts) {
        opts = opts || {};
        const _render = prepareTemplate(template, opts.renderers, opts.handlers, opts.attributeHandler, opts.extends);
        idom.patch(container, _render, model);
    }
    exports.render = render;
    function renderNode(node, model, renderers, handlers, attributeHandler) {
        switch (node.nodeType) {
            // We encounter DocumentFragments when we recurse into a nested template
            case Node.DOCUMENT_FRAGMENT_NODE:
                let children = node.childNodes;
                for (let i = 0; i < children.length; i++) {
                    renderNode(children[i], model, renderers, handlers, attributeHandler);
                }
                break;
            case Node.ELEMENT_NODE:
                let element = node;
                if (element.tagName.toLowerCase() === 'template') {
                    let template = element;
                    // Handle template types, like: 'if' and 'repeat'
                    let typeAttribute = element.getAttribute('type');
                    if (typeAttribute) {
                        let handler = handlers.get(typeAttribute);
                        if (handler) {
                            handler(template, model, renderers, handlers, attributeHandler);
                        }
                        else {
                            console.warn('No handler for template type', typeAttribute);
                            return;
                        }
                    }
                    // Handle named holes
                    let nameAttribute = element.getAttribute('name');
                    if (nameAttribute) {
                        if (renderers) {
                            let renderer = renderers[nameAttribute];
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
                }
                else {
                    // elementOpen has a weird API. It takes varargs of alternating
                    // attribute name/value pairs
                    let propertyValuePairs = [];
                    let attributes = element.attributes;
                    let handledAttributes = [];
                    for (let i = 0; i < attributes.length; i++) {
                        let attr = attributes[i];
                        if (attributeHandler && attributeHandler.matches(attr.name)) {
                            handledAttributes.push(attr);
                        }
                        else {
                            // TODO: if attribute is a literal, add it to statics instead
                            propertyValuePairs.push(attr.name);
                            propertyValuePairs.push(getValue(attr, model));
                        }
                    }
                    let tagName = element.tagName.toLowerCase();
                    let el = idom.elementOpen(tagName, null, null, ...propertyValuePairs);
                    for (let i = 0; i < handledAttributes.length; i++) {
                        let attr = handledAttributes[i];
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
            default:
                console.warn('unhandled node type', node.nodeType);
        }
    }
    exports.renderNode = renderNode;
});
/// <reference path="../../stampino.d.ts" />
define("test/stampino_test", ["require", "exports", "stampino"], function (require, exports, stampino) {
    "use strict";
    const template = document.querySelector('static');
    const output = document.createElement('div');
    stampino.render(template, output, {});
});
