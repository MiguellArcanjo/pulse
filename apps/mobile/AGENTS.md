This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Pulse-specific rules (override the generic Expo guidance below)

- **Do not use EAS Build/Submit/Update.** The project uses a free Apple account; EAS device
  builds require a paid Apple Developer membership. iOS builds come from
  `.github/workflows/ios-build.yml` (unsigned IPA on a macOS runner), signed and installed by
  AltServer on Windows. See `docs/IOS-SIDELOAD.md` and `docs/ARCHITECTURE.md` §15.
- iOS only. Development happens on Windows: no Xcode, no simulator.
- Navigation library not decided yet (Expo Router vs React Navigation); decide before adding it.
- Use pnpm from the monorepo root (`pnpm --filter @pulse/mobile ...`); `pnpm exec expo install`
  inside `apps/mobile` for SDK-aligned versions.
- Never store secrets outside `expo-secure-store`. Never call AI providers or Windows services
  directly from the app — everything goes through Pulse Core.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- (Template default, not yet adopted by Pulse) Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building

Not EAS — see "Pulse-specific rules" above.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a new development build: run the `iOS build` workflow (variant `dev-client`) and sideload it.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
