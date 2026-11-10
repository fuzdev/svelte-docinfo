export type Exclude<T, U> = T extends U ? never : T;
export type Pick<T, K extends keyof T> = { [P in K]: T[P] };
export type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
export type Partial<T> = { [P in keyof T]?: T[P] };
export type Readonly<T> = { readonly [P in keyof T]: T[P] };
