export interface Message {
    from: string, 
    to: string,
    content: string | undefined | null,
    content_object: object | undefined | null 
}