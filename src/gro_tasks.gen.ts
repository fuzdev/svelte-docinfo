import { gen_task_registry } from '@fuzdev/gro/task_registry.ts';
import { fs } from '@fuzdev/gro/fs.ts';
import { create_fs_paths } from '@fuzdev/gro/fs_paths.ts';

export const gen = gen_task_registry(create_fs_paths(fs));
