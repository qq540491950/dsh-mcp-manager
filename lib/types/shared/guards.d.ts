/**
 * 不可信输入的收窄守卫 —— 两半边共用。
 *
 * 为什么需要它们：本插件的输入有两类，**类型系统都描述不了**：
 *   · 宿主侧：用户手写的 YAML（`cordis.patch.yml` 里的 group config）与浏览器发来的 HTTP 体；
 *   · 客户端侧：宿主返回的 JSON 快照（可能是旧宿主、可能被外部改坏）。
 * 所以读之前一律先收窄。用守卫而不是 `as`：`as` 只是让编译器闭嘴，守卫是真的在检查。
 *
 * 纯函数、零依赖，因此可以在自检里直接 import（Node ≥22.18 的类型擦除）。
 */
/**
 * 判断一个值是不是"普通对象"（YAML / JSON 里的 record）。
 * 数组也是对象，但它的语义是"行列表"，所以单独排掉。
 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** 把一个不可信的值收窄成"可以安全读属性"的表；不是 record 就当作空表。 */
export declare function asRecord(value: unknown): Record<string, unknown>;
/** 读一个字符串字段；非字符串一律当作"没写"（YAML 里 `serverName: 123` 这类不该被当成名字）。 */
export declare function readString(source: Record<string, unknown>, key: string): string | undefined;
/**
 * 把不可信的值读成字符串：**只认 string / number**，其余（对象、数组、null）一律当作"没写"。
 *
 * 不用 `String(value ?? '')`：那会把 `{}` 变成 `"[object Object]"`，于是一个畸形配置会以
 * "名字叫 [object Object] 的服务器"的形式出现在错误信息里，比直接说"没填"更难查。
 * 数字仍按原样转字符串（`serverName: 123` 这种手写 YAML 要能读出来）。
 */
export declare function asText(value: unknown): string;
