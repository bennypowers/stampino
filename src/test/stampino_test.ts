/// <reference path="../../node_modules/@types/mocha/index.d.ts" />

import * as idom from 'incremental-dom';
import * as stampino from '../stampino.js';
import {RenderContext} from '../stampino.js';

const assert = chai.assert;

suite('stampino', () => {

  let output: HTMLDivElement;

  setup(() => {
    output = document.createElement('div');
  });

  test('renders a static template', () => {
    const template = getTemplate('static');
    stampino.render(template, output, {});
    assert.equal(output.innerHTML.trim(), '<div>static</div>');
  });

  test('renders a simple binding', () => {
    const template = getTemplate('simple-binding');
    stampino.render(template, output, {foo: 'foo'});
    assert.equal(output.innerHTML.trim(), '<div>foo</div>');
  });

  test('renders an attribute binding', () => {
    const template = getTemplate('attribute-binding');
    stampino.render(template, output, {foo: 'foo'});
    assert.equal(output.innerHTML.trim(), '<div foo="foo"></div>');
  });

  test('renders a property binding', () => {
    const template = getTemplate('property-binding');
    stampino.render(template, output, {foo: 'foo'});
    assert.equal(output.innerHTML.trim(), '<div></div>');
    assert.equal(output.querySelector('div')!['foo'], 'foo');
  });

  suite('if handler', () => {

    test('does not render for a false condition', () => {
      const template = getTemplate('if-handler');
      stampino.render(template, output, {render: 'no'});
      assert.equal(output.innerHTML.trim(), '');
    });

    test('does render for a true condition', () => {
      const template = getTemplate('if-handler');
      stampino.render(template, output, {render: 'yes'});
      assert.equal(output.innerHTML.trim(), 'RENDERED');
    });

  });

  suite('repeat handler', () => {

    test('does not render for an empty list', () => {
      const template = getTemplate('repeat-handler');
      stampino.render(template, output, {items: []});
      assert.equal(output.innerHTML.trim(), '');
    });

    test('does render for a non-empty list', () => {
      const template = getTemplate('repeat-handler');
      stampino.render(template, output, {items: ['a', 'b', 'c']});
      assert.equal(output.innerHTML.trim(), 'abc');
    });

    test('includes `index` in the scope', () => {
      const template = getTemplate('repeat-handler-index');
      stampino.render(template, output, {items: ['a', 'b', 'c']});
      assert.equal(output.innerHTML.trim(), '012');
    });

    test('includes names from outer scope', () => {
      const template = getTemplate('repeat-handler-scope');
      stampino.render(template, output, {outer: 'A', items: ['a', 'b', 'c']});
      assert.equal(output.innerHTML.trim(), 'AAA');
    });

  });

  suite('inheritance', () => {

    test('sub-template with no super block renders super-template first', () => {
      const superTemplate = getTemplate('inheritance-super-1');
      const subTemplate = getTemplate('inheritance-sub-1');
      stampino.render(subTemplate, output, {}, {extends: superTemplate});
      assert.equal(output.innerHTML.trim(), 'super');
    });

    test('sub-template with super block renders sub-template first', () => {
      const superTemplate = getTemplate('inheritance-super-1');
      const subTemplate = getTemplate('inheritance-sub-2');
      stampino.render(subTemplate, output, {}, {extends: superTemplate});
      assert.equal(output.innerHTML.trim(), 'subsupersub');
    });

    test('super blocks render default content', () => {
      const superTemplate = getTemplate('inheritance-super-2');
      const subTemplate = getTemplate('inheritance-sub-1');
      stampino.render(subTemplate, output, {}, {extends: superTemplate});
      assert.equal(output.innerHTML.trim(), 'superdefaultsuper');      
    });

    test('super blocks are overridden in sub templates', () => {
      const superTemplate = getTemplate('inheritance-super-2');
      const subTemplate = getTemplate('inheritance-sub-3');
      stampino.render(subTemplate, output, null, {extends: superTemplate});
      console.log(output);
      assert.equal(output.innerHTML.trim(), 'supersubtemplatesuper');      
    });

    test('super blocks are overridden in super directives', () => {
      const superTemplate = getTemplate('inheritance-super-2');
      const subTemplate = getTemplate('inheritance-sub-4');
      stampino.render(subTemplate, output, null, {extends: superTemplate});
      console.log(output);
      assert.equal(output.innerHTML.trim(), 'subsupersubsupersub');      
    });

  });

  suite('renderer functions', () => {

    test('get rendered', () => {
      const template = getTemplate('renderer');
      stampino.render(template, output, {foo: 'text'}, {
        renderers: new Map([
          ['block-a', (context: RenderContext) => {
            idom.elementOpen('foo-bar', undefined, undefined, []);
            idom.text(context.model['foo']);
            idom.elementClose('foo-bar');
          }]
        ])
      });
      assert.equal(output.innerHTML.trim(), '<foo-bar>text</foo-bar>');
    });

  });

});

function getTemplate(id: string): HTMLTemplateElement {
  return document.querySelector(`#${id}`) as HTMLTemplateElement;
}