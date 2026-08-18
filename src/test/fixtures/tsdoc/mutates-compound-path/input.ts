/**
 * Description.
 *
 * @mutates this.items - Description 1
 */
export class Registry {
	items: Array<string> = [];
	add(item: string): void {
		this.items.push(item);
	}
}
