export interface Message {
    content: string,
    role: string,
    name?: string,
    tool_call_id?: any
    tool_call?: any
}