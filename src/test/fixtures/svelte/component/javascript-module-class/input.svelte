<script module>
	/**
	 * Description 1
	 * @implements {B}
	 */
	export class A {
		/** @private */
		a = 1;
		/** @protected */
		b = 2;

		/** @param {number} x */
		constructor(x) {
			/**
			 * Description 2
			 * @type {number}
			 */
			this.c = x;
			/** @private */
			this.d = x;
			/** @readonly */
			this.e = $state(0);
		}

		/** @protected */
		get f() {
			return this.a + this.b;
		}
	}

	export class C extends Error {
		/** @param {string} x */
		constructor(x) {
			super(x);
			this.name = 'C';
			this.a = 1;
			this.toString = () => 'C';
		}
	}

	/**
	 * @typedef {object} B
	 * @property {number} c
	 */
</script>

<p>text1</p>
