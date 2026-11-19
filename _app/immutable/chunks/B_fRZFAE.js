import{A as e,K as t,M as n,Q as r,Y as i,Z as a,ct as o,et as s,ft as c,h as l,pt as u,st as d}from"./DQZufSt_.js";import{t as f}from"./8w-1EQp4.js";import{n as p,r as m,t as h}from"./BVjNJPnU.js";import{t as g}from"./Cpaw058w.js";import{n as _}from"./BiGJveFX.js";var v=n(`<!> <p>A <code>@type</code>, <code>@param</code>, <code>@returns</code>, or <code>@property</code> type is the written annotation at its site, so it recovers alias names and keeps union order
			as written, like a TS annotation (see <!>).</p> <!>`,1),y=n(`<!> <p>A <code>@typedef</code> or <code>@callback</code> documents as a type alias, like <!>: <code>@property</code> tags become members
			with their descriptions, a callback gets a <code>(call)</code> member, and <code>@template</code> tags its generics. A <!> with a
			same-named <code>@typedef A</code> documents as one declaration with <!>.</p> <p>As in your editor's hover, a JSDoc block that declares a typedef and has no <code>@param</code> or <code>@returns</code> documents the typedef, not the declaration below
			it. Give the declaration its own block:</p> <!> <p>A <code>@module</code> block keeps its prose for the module, and a component's JSDoc above <code>$props()</code> for the component. A <code>@typedef</code> in a component's HTML <code>@component</code> comment documents nothing. Declare a component's props typedef in a
			block of its own, since svelte2tsx copies the block above <code>$props()</code> into its
			generated code, where svelte-check reports a typedef as a duplicate.</p> <p>An <code>@enum</code> const documents as <!>, one
			member per property.</p>`,1),b=n(`<!> <p><code>@template</code> tags are <code>genericParams</code> on functions, classes, and methods,
			with constraints (<code></code>) and defaults
			(<code>@template [K='k']</code>), as <!> writes them.</p>`,1),x=n(`<!> <p>Each <code>@overload</code> tag declares a signature, documented by the block it sits in and
			the <code>@param</code> and <code>@returns</code> tags after it. The first overload documents
			the function, and the implementation's own block is hidden, as in a TS overload set, so put
			the prose and tags like <code>@example</code> on the first overload; a documented
			implementation warns <code>implementation_doc_hidden</code>. Write <code>@template</code> before <code>@overload</code>, since TypeScript rejects one between <code>@overload</code> and
			its <code>@param</code>s.</p> <!>`,1),S=n(`<!> <ul><li><code>@private</code> hides a member, and <code>@protected</code>, <code>@public</code>, and <code>@readonly</code> add <code>modifiers</code>, like the TS keywords.</li> <li><code></code> fills <code>implements</code>, and <code></code> beside <!> gives the type arguments.</li> <li><!> in the constructor, a method, or an accessor
				declares a member (static in a static method or block), typed by its first <code>@type</code> and documented by its first documented assignment, preferring the
				constructor's. These members list just before the constructor, where a TS class declares its
				fields.</li> <li>A name the base class declares stays the base's
				(<!> in an <code>Error</code> subclass lists
				nothing). To document it on the subclass, write a field.</li></ul>`,1),C=n(`<!> <p>A JS component's props come from the JSDoc <code>@type</code> on <code>$props()</code>, often
			a typedef, else from the destructuring. A legacy component's <!> props read their <code>@type</code> and
			initializer.</p> <!>`,1),w=n(`<!> <p>CommonJS isn't modeled. A JS file with no <code>import</code> or <code>export</code> that
			exports through <code>module.exports</code> or <code>exports.x</code> documents nothing and
			warns <code>commonjs_unsupported</code>. Under <code>node16</code>/<code>nodenext</code> or <!>, TypeScript reads CommonJS
			exports itself, so named ones (<code>exports.x</code>, <!>) document. Exports defined
			through <code>Object.defineProperty</code> or a UMD wrapper document nothing, with no warning.</p>`,1),T=n(`<!> <ul><li>Assignments outside a class (<!>, <!>) don't add class members.</li> <li>An <code>@overload</code>'s rest parameter (<!>) is <code>rest</code>, but types as <!>, as
				TypeScript reads it.</li> <li>A <code>@property</code> after a non-<code>@property</code> tag leaves the typedef's
				property list, as TypeScript reads it, and is dropped.</li></ul>`,1),E=n(`<section><p>JS modules (<code>.js</code>, <code>.mjs</code>, <code>.jsx</code>), JS components, and JS <!> blocks document like their TS
			twins: svelte-docinfo reads their JSDoc the way TypeScript's checker does, so <!> types a parameter as <!> would. <code>allowJs</code> is always on for the
			analysis, so no tsconfig change is needed, and <code>checkJs</code> isn't required.</p> <p>TypeScript reads none of this in <code>.ts</code> files: there, JSDoc types and the tags below
			annotate nothing, as in your editor.</p></section> <!> <!> <!> <!> <!> <!> <!> <!>`,1);function D(n,D){o(D,!0);let O=_(`js`);l(`1urxn28`,e=>{t(()=>{i.title=`JS and JSDoc - svelte-docinfo`})}),m(n,{get tome(){return O},children:(t,n)=>{var i=E(),o=r(i),l=a(o),d=s(a(l),7);f(d,{lang:`svelte`,inline:!0,dangerous_raw_html:`<span class="token_tag"><span class="token_tag"><span class="token_punctuation token_tag_punctuation">&lt;</span>script</span> <span class="token_attr_name">module</span><span class="token_punctuation token_tag_punctuation">></span></span>`});var m=s(d,2);f(m,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_comment">/** @param {string} a */</span>`});var _=s(m,2);f(_,{lang:`ts`,inline:!0,dangerous_raw_html:`a<span class="token_operator">:</span> <span class="token_builtin">string</span>`}),c(5),u(l),c(2),u(o);var D=s(o,2);p(D,{children:(t,n)=>{var i=v(),o=r(i);h(o,{text:`Types and parameters`});var l=s(o,2),d=s(a(l),9);g(d,{slug:`structured-types`}),c(),u(l);var p=s(l,2);f(p,{lang:`js`,dangerous_raw_html:`<span class="token_comment">/**
 * @param {string} a - a required parameter
 * @param {number} [b] - optional, as is \`{number=}\`
 * @param {number} [c=0] - optional, with defaultValue "0"
 * @param {object} [d] - an options object
 * @param {boolean} [d.e] - documents d's property e
 */</span>
<span class="token_special_keyword">export</span> <span class="token_keyword">function</span> <span class="token_function">fn</span><span class="token_punctuation">(</span>a<span class="token_punctuation">,</span> b<span class="token_punctuation">,</span> c <span class="token_operator">=</span> <span class="token_number">0</span><span class="token_punctuation">,</span> d<span class="token_punctuation">)</span> <span class="token_punctuation">{}</span>`}),e(t,i)},$$slots:{default:!0}});var O=s(D,2);p(O,{children:(t,n)=>{var i=y(),o=r(i);h(o,{text:`@typedef and @callback`});var l=s(o,2),d=s(a(l),5);f(d,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">type</span> <span class="token_class_name">A</span> <span class="token_operator">=</span> …`});var p=s(d,8);f(p,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">const</span> <span class="token_capitalized_identifier token_class_name">A</span>`});var m=s(p,4);f(m,{lang:`ts`,inline:!0,dangerous_raw_html:`mergedValue<span class="token_operator">:</span> <span class="token_boolean">true</span>`}),c(),u(l);var g=s(l,4);f(g,{lang:`js`,dangerous_raw_html:`<span class="token_comment">/**
 * A point.
 * @typedef {object} Point
 * @property {number} x - the horizontal position
 * @property {number} y - the vertical position
 */</span>

<span class="token_comment">/** The origin. */</span>
<span class="token_special_keyword">export</span> <span class="token_keyword">const</span> <span class="token_constant">ORIGIN</span> <span class="token_operator">=</span> <span class="token_punctuation">{</span>x<span class="token_operator">:</span> <span class="token_number">0</span><span class="token_punctuation">,</span> y<span class="token_operator">:</span> <span class="token_number">0</span><span class="token_punctuation">};</span>`});var _=s(g,4),v=s(a(_),3);f(v,{lang:`ts`,inline:!0,dangerous_raw_html:`kind<span class="token_operator">:</span> <span class="token_string">'enum'</span>`}),c(),u(_),e(t,i)},$$slots:{default:!0}});var k=s(O,2);p(k,{children:(t,n)=>{var i=b(),o=r(i);h(o,{text:`@template`});var l=s(o,2),d=s(a(l),4);d.textContent=`@template {string} K`;var p=s(d,4);f(p,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_operator">&lt;</span><span class="token_capitalized_identifier token_class_name">K</span> <span class="token_keyword">extends</span> <span class="token_class_name">string</span> <span class="token_operator">=</span> <span class="token_string">'k'</span><span class="token_operator">></span>`}),c(),u(l),e(t,i)},$$slots:{default:!0}});var A=s(k,2);p(A,{children:(t,n)=>{var i=x(),a=r(i);h(a,{text:`@overload`});var o=s(a,4);f(o,{lang:`js`,dangerous_raw_html:`<span class="token_comment">/**
 * Doubles a number or a bigint.
 * @overload
 * @param {number} n - the number to double
 * @returns {number}
 * @example double(2) // 4
 */</span>
<span class="token_comment">/**
 * @overload
 * @param {bigint} n - the bigint to double
 * @returns {bigint}
 */</span>
<span class="token_comment">/** @param {number | bigint} n */</span>
<span class="token_special_keyword">export</span> <span class="token_keyword">function</span> <span class="token_function">double</span><span class="token_punctuation">(</span>n<span class="token_punctuation">)</span> <span class="token_punctuation">{</span>
  <span class="token_special_keyword">return</span> <span class="token_comment">/** @type {any} */</span> <span class="token_punctuation">(</span>n<span class="token_punctuation">)</span> <span class="token_operator">*</span> <span class="token_number">2</span><span class="token_punctuation">;</span>
<span class="token_punctuation">}</span>`}),e(t,i)},$$slots:{default:!0}});var j=s(A,2);p(j,{children:(t,n)=>{var i=S(),o=r(i);h(o,{text:`Classes`});var l=s(o,2),d=s(a(l),2),p=a(d);p.textContent=`@implements {A}`;var m=s(p,4);m.textContent=`@extends {Base<T>}`;var g=s(m,2);f(g,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">extends</span> <span class="token_class_name">Base</span>`}),c(),u(d);var _=s(d,2),v=a(_);f(v,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">this</span><span class="token_punctuation">.</span>x <span class="token_operator">=</span> …`}),c(3),u(_);var y=s(_,2),b=s(a(y));f(b,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">this</span><span class="token_punctuation">.</span>name <span class="token_operator">=</span> …`}),c(3),u(y),u(l),e(t,i)},$$slots:{default:!0}});var M=s(j,2);p(M,{children:(t,n)=>{var i=C(),o=r(i);h(o,{text:`Components`});var l=s(o,2),d=s(a(l),5);f(d,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_special_keyword">export</span> <span class="token_keyword">let</span>`}),c(3),u(l);var p=s(l,2);f(p,{lang:`svelte`,dangerous_raw_html:`<span class="token_tag"><span class="token_tag"><span class="token_punctuation token_tag_punctuation">&lt;</span>script</span><span class="token_punctuation token_tag_punctuation">></span></span><span class="token_script"><span class="token_lang_ts">
	<span class="token_comment">/**
	 * @typedef {object} Props
	 * @property {string} a - documents prop a
	 */</span>

	<span class="token_comment">/**
	 * The component's docs.
	 * @type {Props}
	 */</span>
	<span class="token_keyword">const</span> <span class="token_punctuation">{</span>a<span class="token_punctuation">}</span> <span class="token_operator">=</span> <span class="token_function">$props</span><span class="token_punctuation">();</span>
</span></span><span class="token_tag"><span class="token_tag"><span class="token_punctuation token_tag_punctuation">&lt;/</span>script</span><span class="token_punctuation token_tag_punctuation">></span></span>`}),e(t,i)},$$slots:{default:!0}});var N=s(M,2);p(N,{children:(t,n)=>{var i=w(),o=r(i);h(o,{text:`CommonJS`});var l=s(o,2),d=s(a(l),15);f(d,{lang:`ts`,inline:!0,dangerous_raw_html:`moduleDetection<span class="token_operator">:</span> <span class="token_string">'force'</span>`});var p=s(d,4);f(p,{lang:`ts`,inline:!0,dangerous_raw_html:`module<span class="token_punctuation">.</span>exports <span class="token_operator">=</span> <span class="token_punctuation">{</span>a<span class="token_punctuation">,</span> b<span class="token_punctuation">}</span>`}),c(3),u(l),e(t,i)},$$slots:{default:!0}});var P=s(N,2);p(P,{children:(t,n)=>{var i=T(),o=r(i);h(o,{text:`Limits`});var l=s(o,2),d=a(l),p=s(a(d));f(p,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_capitalized_identifier token_class_name">A</span><span class="token_punctuation">.</span>prototype<span class="token_punctuation">.</span>x <span class="token_operator">=</span> …`});var m=s(p,2);f(m,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_capitalized_identifier token_class_name">A</span><span class="token_punctuation">.</span>x <span class="token_operator">=</span> …`}),c(),u(d);var g=s(d,2),_=s(a(g),3);f(_,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_punctuation">{</span><span class="token_operator">...</span><span class="token_capitalized_identifier token_class_name">T</span><span class="token_punctuation">}</span>`});var v=s(_,4);f(v,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_capitalized_identifier token_class_name">T</span> <span class="token_operator">|</span> <span class="token_keyword">undefined</span>`}),c(),u(g),c(2),u(l),e(t,i)},$$slots:{default:!0}}),e(t,i)},$$slots:{default:!0}}),d()}export{D as t};