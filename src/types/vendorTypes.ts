// Loose stand-ins for types that used to come from @modelcontextprotocol/sdk
// and @opentelemetry/*. Both packages are gone (MCP and telemetry were
// removed); these names only survive in dead signatures.
export type CallToolResult = { content: unknown[]; isError?: boolean; [k: string]: unknown }
export type ToolAnnotations = Record<string, unknown>
export type ElicitResult = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }
export type ElicitRequestURLParams = { message: string; url: string; [k: string]: unknown }
export type JSONRPCMessage = Record<string, unknown>
export type ReadResourceResult = { contents: unknown[] }
export type Attributes = Record<string, string | number | boolean | undefined>
export type Meter = unknown
export type MetricOptions = Record<string, unknown>
export type LoggerProvider = unknown
export type MeterProvider = unknown
export type BasicTracerProvider = unknown
export type OTelLogger = unknown
