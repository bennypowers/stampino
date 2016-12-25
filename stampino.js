var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
define("stampino", ["require", "exports", "incremental-dom", "polymer-expressions"], function (require, exports, idom, polymer_expressions_1) {
    "use strict";
    const astFactory = new polymer_expressions_1.EvalAstFactory();
    const toCamelCase = (s) => s.replace(/-(\w)/, (_, p1) => p1.toUppercase());
    /**
     * incremental-dom attribute handler that sets properties on elements by
     * default and calls setAttribute if the attribtue name ends in `$`.
     */
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
    /**
     * Returns the value of a text node or attribute, evaluating it as an expression
     * if the value starts with `{{` and ends with `}}`.
     */
    function getValue(node, model) {
        let ast = _expressionCache.get(node);
        if (ast) {
            return ast.evaluate(model);
        }
        const value = node.textContent;
        if (value == null)
            return null;
        if (value.startsWith('{{') && value.endsWith('}}')) {
            const expression = value.substring(2, value.length - 2).trim();
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
    exports.ifHandler = (template, context) => {
        const ifAttribute = template.getAttributeNode('if');
        if (ifAttribute && getValue(ifAttribute, context.model)) {
            renderNode(template.content, context);
        }
    };
    exports.repeatHandler = (template, context) => {
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
                const itemContext = __assign({}, context, { model: itemModel });
                renderNode(template.content, itemContext);
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
                const renderer = (context) => renderNode(block.content, context);
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
    function prepareTemplate(template, options) {
        if (template == null) {
            throw new Error('null template');
        }
        const handlers = options && options.handlers || exports.defaultHandlers;
        const renderers = options && options.renderers || new Map();
        const superTemplates = options && options.superTemplates;
        const attributeHandler = options && options.attributeHandler;
        let superRenderer;
        if (superTemplates) {
            superRenderer = superTemplates.reduceRight((p, c) => templateToRenderer(c, p), undefined);
        }
        const templateRenderer = templateToRenderer(template, superRenderer);
        return (model) => templateRenderer({
            model,
            renderers: renderers,
            handlers: handlers,
            attributeHandler,
        });
    }
    exports.prepareTemplate = prepareTemplate;
    function templateToRenderer(template, superRenderer) {
        if (superRenderer) {
            const superBlock = template.content.querySelector('[name=super]');
            const blockOverrides = getRenderers(superBlock || template);
            const superRendererWithOverrides = (context) => {
                // Set renderers to the block overrides from the sub-template:
                const renderers = new Map(blockOverrides);
                // Copy in renderers from context, which take precedence
                for (const entry of context.renderers) {
                    renderers.set(entry[0], entry[1]);
                }
                superRenderer(__assign({}, context, { renderers }));
            };
            if (superBlock) {
                // If the template has an explicit "super call", render it, but
                // add in a new 'super' block to render the super template
                return (context) => {
                    const renderers = new Map(context.renderers);
                    renderers.set('super', superRendererWithOverrides);
                    renderNode(template.content, __assign({}, context, { renderers }));
                };
            }
            else {
                // If there's no explicit "super call", directly render the super-template
                // which will use block overrides from the sub-template
                return superRendererWithOverrides;
            }
        }
        else {
            return (context) => {
                renderNode(template.content, context);
            };
        }
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
    function render(template, container, model, options) {
        idom.patch(container, prepareTemplate(template, options), model);
    }
    exports.render = render;
    function renderNode(node, context) {
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
                const element = node;
                if (element.tagName === 'TEMPLATE') {
                    const template = element;
                    // Handle template types, like: 'if' and 'repeat'
                    const typeAttribute = element.getAttribute('type');
                    if (typeAttribute) {
                        const handler = context.handlers.get(typeAttribute);
                        if (handler) {
                            handler(template, context);
                        }
                        else {
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
                }
                else {
                    // elementOpen has a weird API. It takes varargs of alternating
                    // attribute name/value pairs
                    const propertyValuePairs = [];
                    const attributes = element.attributes;
                    const handledAttributes = [];
                    for (let i = 0; i < attributes.length; i++) {
                        const attr = attributes[i];
                        if (context.attributeHandler && context.attributeHandler.matches(attr.name)) {
                            handledAttributes.push(attr);
                        }
                        else {
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
                        context.attributeHandler.handle(el, attr.name, attr.value, context.model);
                    }
                    const children = node.childNodes;
                    for (let i = 0; i < children.length; i++) {
                        renderNode(children[i], context);
                    }
                    idom.elementClose(element.tagName);
                }
                break;
            case Node.TEXT_NODE:
                const value = getValue(node, context.model);
                idom.text(value);
                break;
            case Node.COMMENT_NODE:
                break;
            default:
                console.warn('unhandled node type', node.nodeType);
        }
    }
    exports.renderNode = renderNode;
});
