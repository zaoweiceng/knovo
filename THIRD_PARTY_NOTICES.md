# Third-party software

Knovo's own source is licensed under [MIT](LICENSE). Dependencies, their source code, bundled fonts, and other assets retain their upstream licenses; the root license does not relicense them.

Exact resolved dependency versions are recorded in `pnpm-lock.yaml`. After installing, inspect the production dependency inventory with:

```sh
pnpm licenses list --prod
```

The current dependency tree includes MIT, ISC, BSD, Apache-2.0, Unlicense, and the following packages that need particular attention when distributing bundled builds:

| Package | License in the installed package | Upstream |
| --- | --- | --- |
| `elkjs` 0.9.3 (via Mermaid) | EPL-2.0 | [Source and license](https://github.com/kieler/elkjs/tree/0.9.3) |
| `dompurify` | MPL-2.0 OR Apache-2.0 | [Source and licenses](https://github.com/cure53/DOMPurify) |
| `khroma` 2.1.0 | MIT, supplied in its `license` file; package metadata omits the SPDX field | [Source and license](https://github.com/fabiospampinato/khroma) |

This source repository does not check in `node_modules/` or `dist/`. If distributing a prebuilt application, include the applicable dependency license texts, copyright notices, and any required source availability information with the release. Recheck the inventory when updating dependencies. Generated skill packages include Knovo's MIT license; their installed runtime dependencies retain their own notices.
