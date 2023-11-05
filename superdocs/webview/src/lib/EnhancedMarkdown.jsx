import React from 'react'
import ReactDom from 'react-dom'
import Markdown from 'react-markdown'
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter'
import {dark} from 'react-syntax-highlighter/dist/esm/styles/prism'
import ReactJson from 'react-json-view';
import {Box, Group, Button, Text, Badge} from "@mantine/core";
import { VSCodeMessage } from './VSCodeMessage'

export default function EnhancedMarkdown({ content, snippets, role }) {

    let sendReplace = (snippet, newCode) => {
        let content = {
            originalCode: snippet.code,
            newCode: newCode,
            filepath: snippet.filepath
        };
        console.log("Running sendReplace: ", content);
        VSCodeMessage.postMessage({
            type: "replaceSnippet",
            content: content
        });
    }

    return (
        <>
            <Badge
                size="xl"
                variant="gradient"
                gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
            >
            {role}
            </Badge>

            <Markdown
                children={content}
                components={{
                    code(props) {
                        const {children, className, node, ...rest} = props
                        const match = /language-(\w+)/.exec(className || '')
                        
                        // console.log("Language match: ", match, rest, node);
                        if(match){
                            if(match[1] === 'json'){
                                try {
                                    let jsonValue = JSON.parse(String(children).replace(/\n$/, ''));
                                    return <ReactJson theme="hopscotch" src={jsonValue}/>
                                } catch (e) {
                                    // continue on
                                }
                            }    
                        }

                        return match ? (
                            <Box>
                                {role === "human" && snippets.map((item, index) => (
                                    (item.code.trim() === String(children).replace(/\n$/, '').trim()  && <Badge color="blue">Snippet {index}</Badge>)
                                ))}

                                <SyntaxHighlighter
                                    {...rest}
                                    children={String(children).replace(/\n$/, '')}
                                    style={dark}
                                    language={match[1]}
                                    PreTag="div"
                                />

                                {(role === "ai" && snippets.length > 0) && <Group style={{flexWrap: "wrap"}}>
                                    Replace in snippet:
                                    {/* <Text>{JSON.stringify(snippets)}</Text> */}
                                    {snippets.map((item, index) => (
                                        <Button onClick={() => sendReplace(item, String(children).replace(/\n$/, ''))}>{index}</Button>
                                    ))}
                                </Group>}
                            </Box>
                        ) : (
                        <code {...rest} className={className}>
                            {children}
                            {/* {snippets.length > 0 && 
                                <Group style={{flexWrap: "wrap"}}>
                                    Replace in snippet:
                                    {snippets.map((item, index) => {
                                        <Button onClick={() => sendReplace(item, String(children).replace(/\n$/, ''))}>{index}</Button>
                                    })}
                                </Group>
                            } */}
                        </code>
                        )
                    }
                }}
            />
        </>
    );
}