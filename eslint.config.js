import { configs } from '@ryanatkn/eslint-config';

export default [
	...configs,
	{
		ignores: ['examples/**/*']
	}
];
