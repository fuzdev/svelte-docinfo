import{$ as e,A as t,G as n,J as r,M as i,X as a,Z as o,dt as s,ft as c,h as l,ot as u,st as d}from"./Dv5cY9UL.js";import{n as f}from"./DhleYhgh.js";import{t as p}from"./BDNXRRmV.js";import{t as m}from"./BNHTZZj6.js";import{n as h,r as g,t as _}from"./zIc-2UJq.js";var v=i(`<!> <p>A <code>@type</code>, <code>@param</code>, <code>@returns</code>, or <code>@property</code> type is the written annotation at its site, so it recovers alias names and keeps union order
			as written, like a TS annotation (see <!>).</p> <!>`,1),y=i(`<!> <p>A <code>@typedef</code> or <code>@callback</code> documents as a type alias, like <!>: <code>@property</code> tags become members
			with their descriptions, a callback gets a <code>(call)</code> member, and <code>@template</code> tags its generics. A <!> with a
			same-named <code>@typedef A</code> documents as one declaration with <!>.</p> <p>As in your editor's hover, a JSDoc block that declares a typedef and has no <code>@param</code> or <code>@returns</code> documents the typedef, not the declaration below
			it. Give the declaration its own block:</p> <!> <p>A <code>@module</code> block keeps its prose for the module, and a component's JSDoc above <code>$props()</code> for the component. A <code>@typedef</code> in a component's HTML <code>@component</code> comment documents nothing. Declare a component's props typedef in a
			block of its own, since svelte2tsx copies the block above <code>$props()</code> into its
			generated code, where svelte-check reports a typedef as a duplicate.</p> <p>An <code>@enum</code> const documents as <!>, one
			member per property.</p>`,1),b=i(`<!> <p><code>@template</code> tags are <code>genericParams</code> on functions, classes, and methods,
			with constraints (<code></code>) and defaults
			(<code>@template [K='k']</code>), as <!> writes them.</p>`,1),x=i(`<!> <p>Each <code>@overload</code> tag declares a signature, documented by the block it sits in and
			the <code>@param</code> and <code>@returns</code> tags after it. The first overload documents
			the function, and the implementation's own block is hidden, as in a TS overload set, so put
			the prose and tags like <code>@example</code> on the first overload; a documented
			implementation warns <code>implementation_doc_hidden</code>. Write <code>@template</code> before <code>@overload</code>, since TypeScript rejects one between <code>@overload</code> and
			its <code>@param</code>s.</p> <!>`,1),S=i(`<!> <ul><li><code>@private</code> hides a member, and <code>@protected</code>, <code>@public</code>, and <code>@readonly</code> add <code>modifiers</code>, like the TS keywords.</li> <li><code></code> fills <code>implements</code>, and <code></code> beside <!> gives the type arguments.</li> <li><!> in the constructor, a method, or an accessor
				declares a member (static in a static method or block), typed by its first <code>@type</code> and documented by its first documented assignment, preferring the
				constructor's. These members list just before the constructor, where a TS class declares its
				fields.</li> <li>A name the base class declares stays the base's
				(<!> in an <code>Error</code> subclass lists
				nothing). To document it on the subclass, write a field.</li></ul>`,1),C=i(`<!> <p>A JS component's props come from the JSDoc <code>@type</code> on <code>$props()</code>, often
			a typedef, else from the destructuring. A legacy component's <!> props read their <code>@type</code> and
			initializer.</p> <!>`,1),w=i(`<!> <p>CommonJS isn't modeled. A JS file with no <code>import</code> or <code>export</code> that
			exports through <code>module.exports</code> or <code>exports.x</code> documents nothing and
			warns <code>commonjs_unsupported</code>. Under <code>node16</code>/<code>nodenext</code> or <!>, TypeScript reads CommonJS
			exports itself, so named ones (<code>exports.x</code>, <!>) document. Exports defined
			through <code>Object.defineProperty</code> or a UMD wrapper document nothing, with no warning.</p>`,1),T=i(`<!> <ul><li>Assignments outside a class (<!>, <!>) don't add class members.</li> <li>An <code>@overload</code>'s rest parameter (<!>) is <code>rest</code>, but types as <!>, as
				TypeScript reads it.</li> <li>A <code>@property</code> after a non-<code>@property</code> tag leaves the typedef's
				property list, as TypeScript reads it, and is dropped.</li></ul>`,1),E=i(`<section><p>JS modules (<code>.js</code>, <code>.mjs</code>, <code>.jsx</code>), JS components, and JS <!> blocks document like their TS
			twins: svelte-docinfo reads their JSDoc the way TypeScript's checker does, so <!> types a parameter as <!> would. <code>allowJs</code> is always on for the
			analysis, so no tsconfig change is needed, and <code>checkJs</code> isn't required.</p> <p>TypeScript reads none of this in <code>.ts</code> files: there, JSDoc types and the tags below
			annotate nothing, as in your editor.</p></section> <!> <!> <!> <!> <!> <!> <!> <!>`,1);function D(i,D){d(D,!0);let O=f(`js`);l(`1urxn28`,e=>{n(()=>{r.title=`JS and JSDoc - svelte-docinfo`})}),g(i,{get tome(){return O},children:(n,r)=>{var i=E(),l=o(i),u=a(l),d=e(a(u),7);m(d,{lang:`svelte`,inline:!0,dangerous_raw_html:`<span class="token_tag"><span class="token_tag"><span class="token_punctuation token_tag_punctuation">&lt;</span>script</span> <span class="token_attr_name">module</span><span class="token_punctuation token_tag_punctuation">></span></span>`});var f=e(d,2);m(f,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_comment">/** @param {string} a */</span>`});var g=e(f,2);m(g,{lang:`ts`,inline:!0,dangerous_raw_html:`a<span class="token_operator">:</span> <span class="token_builtin">string</span>`}),s(5),c(u),s(2),c(l);var D=e(l,2);h(D,{children:(n,r)=>{var i=v(),l=o(i);_(l,{text:`Types and parameters`});var u=e(l,2),d=e(a(u),9);p(d,{slug:`structured-types`}),s(),c(u);var f=e(u,2);m(f,{lang:`js`,dangerous_raw_html:`<span class="token_comment">/**
 * @param {string} a - a required parameter
 * @param {number} [b] - optional, as is \`{number=}\`
 * @param {number} [c=0] - optional, with defaultValue "0"
 * @param {object} [d] - an options object
 * @param {boolean} [d.e] - documents d's property e
 */</span>
<span class="token_special_keyword">export</span> <span class="token_keyword">function</span> <span class="token_function">fn</span><span class="token_punctuation">(</span>a<span class="token_punctuation">,</span> b<span class="token_punctuation">,</span> c <span class="token_operator">=</span> <span class="token_number">0</span><span class="token_punctuation">,</span> d<span class="token_punctuation">)</span> <span class="token_punctuation">{}</span>`}),t(n,i)},$$slots:{default:!0}});var O=e(D,2);h(O,{children:(n,r)=>{var i=y(),l=o(i);_(l,{text:`@typedef and @callback`});var u=e(l,2),d=e(a(u),5);m(d,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">type</span> <span class="token_class_name">A</span> <span class="token_operator">=</span> …`});var f=e(d,8);m(f,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">const</span> <span class="token_capitalized_identifier token_class_name">A</span>`});var p=e(f,4);m(p,{lang:`ts`,inline:!0,dangerous_raw_html:`mergedValue<span class="token_operator">:</span> <span class="token_boolean">true</span>`}),s(),c(u);var h=e(u,4);m(h,{lang:`js`,dangerous_raw_html:`<span class="token_comment">/**
 * A point.
 * @typedef {object} Point
 * @property {number} x - the horizontal position
 * @property {number} y - the vertical position
 */</span>

<span class="token_comment">/** The origin. */</span>
<span class="token_special_keyword">export</span> <span class="token_keyword">const</span> <span class="token_constant">ORIGIN</span> <span class="token_operator">=</span> <span class="token_punctuation">{</span>x<span class="token_operator">:</span> <span class="token_number">0</span><span class="token_punctuation">,</span> y<span class="token_operator">:</span> <span class="token_number">0</span><span class="token_punctuation">};</span>`});var g=e(h,4),v=e(a(g),3);m(v,{lang:`ts`,inline:!0,dangerous_raw_html:`kind<span class="token_operator">:</span> <span class="token_string">'enum'</span>`}),s(),c(g),t(n,i)},$$slots:{default:!0}});var k=e(O,2);h(k,{children:(n,r)=>{var i=b(),l=o(i);_(l,{text:`@template`});var u=e(l,2),d=e(a(u),4);d.textContent=`@template {string} K`;var f=e(d,4);m(f,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_operator">&lt;</span><span class="token_capitalized_identifier token_class_name">K</span> <span class="token_keyword">extends</span> <span class="token_class_name">string</span> <span class="token_operator">=</span> <span class="token_string">'k'</span><span class="token_operator">></span>`}),s(),c(u),t(n,i)},$$slots:{default:!0}});var A=e(k,2);h(A,{children:(n,r)=>{var i=x(),a=o(i);_(a,{text:`@overload`});var s=e(a,4);m(s,{lang:`js`,dangerous_raw_html:`<span class="token_comment">/**
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
<span class="token_punctuation">}</span>`}),t(n,i)},$$slots:{default:!0}});var j=e(A,2);h(j,{children:(n,r)=>{var i=S(),l=o(i);_(l,{text:`Classes`});var u=e(l,2),d=e(a(u),2),f=a(d);f.textContent=`@implements {A}`;var p=e(f,4);p.textContent=`@extends {Base<T>}`;var h=e(p,2);m(h,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">extends</span> <span class="token_class_name">Base</span>`}),s(),c(d);var g=e(d,2),v=a(g);m(v,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">this</span><span class="token_punctuation">.</span>x <span class="token_operator">=</span> …`}),s(3),c(g);var y=e(g,2),b=e(a(y));m(b,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_keyword">this</span><span class="token_punctuation">.</span>name <span class="token_operator">=</span> …`}),s(3),c(y),c(u),t(n,i)},$$slots:{default:!0}});var M=e(j,2);h(M,{children:(n,r)=>{var i=C(),l=o(i);_(l,{text:`Components`});var u=e(l,2),d=e(a(u),5);m(d,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_special_keyword">export</span> <span class="token_keyword">let</span>`}),s(3),c(u);var f=e(u,2);m(f,{lang:`svelte`,dangerous_raw_html:`<span class="token_tag"><span class="token_tag"><span class="token_punctuation token_tag_punctuation">&lt;</span>script</span><span class="token_punctuation token_tag_punctuation">></span></span><span class="token_script"><span class="token_lang_ts">
	<span class="token_comment">/**
	 * @typedef {object} Props
	 * @property {string} a - documents prop a
	 */</span>

	<span class="token_comment">/**
	 * The component's docs.
	 * @type {Props}
	 */</span>
	<span class="token_keyword">const</span> <span class="token_punctuation">{</span>a<span class="token_punctuation">}</span> <span class="token_operator">=</span> <span class="token_function">$props</span><span class="token_punctuation">();</span>
</span></span><span class="token_tag"><span class="token_tag"><span class="token_punctuation token_tag_punctuation">&lt;/</span>script</span><span class="token_punctuation token_tag_punctuation">></span></span>`}),t(n,i)},$$slots:{default:!0}});var N=e(M,2);h(N,{children:(n,r)=>{var i=w(),l=o(i);_(l,{text:`CommonJS`});var u=e(l,2),d=e(a(u),15);m(d,{lang:`ts`,inline:!0,dangerous_raw_html:`moduleDetection<span class="token_operator">:</span> <span class="token_string">'force'</span>`});var f=e(d,4);m(f,{lang:`ts`,inline:!0,dangerous_raw_html:`module<span class="token_punctuation">.</span>exports <span class="token_operator">=</span> <span class="token_punctuation">{</span>a<span class="token_punctuation">,</span> b<span class="token_punctuation">}</span>`}),s(3),c(u),t(n,i)},$$slots:{default:!0}});var P=e(N,2);h(P,{children:(n,r)=>{var i=T(),l=o(i);_(l,{text:`Limits`});var u=e(l,2),d=a(u),f=e(a(d));m(f,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_capitalized_identifier token_class_name">A</span><span class="token_punctuation">.</span>prototype<span class="token_punctuation">.</span>x <span class="token_operator">=</span> …`});var p=e(f,2);m(p,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_capitalized_identifier token_class_name">A</span><span class="token_punctuation">.</span>x <span class="token_operator">=</span> …`}),s(),c(d);var h=e(d,2),g=e(a(h),3);m(g,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_punctuation">{</span><span class="token_operator">...</span><span class="token_capitalized_identifier token_class_name">T</span><span class="token_punctuation">}</span>`});var v=e(g,4);m(v,{lang:`ts`,inline:!0,dangerous_raw_html:`<span class="token_capitalized_identifier token_class_name">T</span> <span class="token_operator">|</span> <span class="token_keyword">undefined</span>`}),s(),c(h),s(2),c(u),t(n,i)},$$slots:{default:!0}}),t(n,i)},$$slots:{default:!0}}),u()}export{D as t};