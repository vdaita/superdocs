import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter'
import {atomDark} from 'react-syntax-highlighter/dist/cjs/styles/prism'
import ReactMarkdown from 'react-markdown';
import ReactJson from 'react-json-view';

export default function EnhancedMarkdown({ content }) {
    return (
        <ReactMarkdown
            children={content}
            components={{
                code({node, inline, className, children, ...props}) {
                    const match = /language-(\w+)/.exec(className || '')
                    if(!inline && match && match[1] === "json"){
                        try {
                            const json = JSON.parse(String(children).replace(/\n$/, ''))
                            return <ReactJson src={json}/>
                        } catch (e) {
                            // not valid JSON, fallback to regular code
                        }
                    }
                    return !inline && match ? (
                    <SyntaxHighlighter
                        {...props}
                        children={String(children).replace(/\n$/, '')}
                        style={atomDark}
                        language={match[1]}
                        PreTag="div"
                    />
                    ) : (
                    <code {...props} className={className}>
                        {children}
                    </code>
                    )
                }
            }}
        />
    );
}