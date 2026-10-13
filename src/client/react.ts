/**
 * 平台依赖的**唯一入口** —— 客户端半边所有对 `react` 的取值都经过这里。
 *
 * 两个理由：
 *   1. **classic JSX runtime**：`h` / `Fragment` 让 JSX 编译成 `react.createElement` 调用，
 *      于是产物只需要 `require("react")`（确定在基座模块表里），不必赌 `react/jsx-runtime`
 *      在不在表里（官方产物确实 require 了它，但我们不必跟着赌）。
 *   2. **单一 require**：打包器会为每个"值 import 了 react"的模块各发一次 `require("react")`。
 *      只在这里 import，产物里就只有一次 —— "我们到底从平台拿了什么"一眼可见。
 *
 * 纪律：`dsh.client.inject` / 运行时依赖只能取基座模块表的种子。
 * 需要别的种子（react-dom 等）就在这里加，不要在组件里直接 import。
 */
import * as react from 'react'

/** JSX 工厂：`<div a="1" />` → `h('div', { a: '1' })`（见 tsconfig.client.json 的 jsxFactory）。 */
export const h = react.createElement

/** `<>…</>` 的工厂（见 tsconfig.client.json 的 jsxFragmentFactory）。 */
export const Fragment = react.Fragment

export const useState = react.useState
export const useEffect = react.useEffect
export const useCallback = react.useCallback
export const useMemo = react.useMemo
