import type { Layout } from './graph_layout.ts';
import json from './dependency_graph.json' with { type: 'json' };

export const dependency_graph: Layout = json as Layout;
