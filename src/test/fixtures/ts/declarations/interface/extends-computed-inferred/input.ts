import * as s from 'schemapkg';

const AEntries = {
	/** Description 1 */
	a: s.string,
	b: s.number
};

/** Description 2 */
export const A = s.object(AEntries);
/** Description 3 */
export interface A extends s.Infer<typeof A> {}

/** Description 4 */
export interface B extends s.ObjectOutput<typeof AEntries> {}
