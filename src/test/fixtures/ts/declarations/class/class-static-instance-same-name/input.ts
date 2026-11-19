export class A {
	static a(): string {
		return '';
	}
	a(): number {
		return 1;
	}
	b(): number {
		return 1;
	}
	static b(a: string): string;
	static b(a: number): string;
	static b(a: string | number): string {
		return String(a);
	}
	static c = 1;
	c = '';
}

export class B {
	static get a(): number {
		return 1;
	}
	get a(): string {
		return '';
	}
	set a(a: string) {
		void a;
	}
}
