import React, { useState } from 'react'
import ReactDom from 'react-dom'
import Markdown from 'react-markdown'
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter'
import {dark} from 'react-syntax-highlighter/dist/esm/styles/prism'
import ReactJson from 'react-json-view';
import {Box, Group, Button, Text, Badge} from "@mantine/core";
import { VSCodeMessage } from './VSCodeMessage'
import ReactDiffViewer from 'react-diff-viewer';
import {CopyToClipboard} from 'react-copy-to-clipboard';

export default function EnhancedMarkdown({ message, hidden, unhide }) {

    

    let sendReplace = (filepath, originalText, newText) => {
        let content = {
            originalCode: originalText,
            newCode: newText,
            filepath: filepath
        };
        console.log("Running sendReplace: ", content);
        VSCodeMessage.postMessage({
            type: "replaceSnippet",
            content: content
        });
    }

    let sendWrite = (filepath, text) => {
        let content = {
            filepath: filepath,
            text: text
        };
        console.log("Running sendWrite: ", content);
        VSCodeMessage.postMessage({
            type: "writeFile",
            content: content
        })
    }

    if(message.content.startsWith("REPLACEMENT")) {
        const parsedContent = JSON.parse(message.content.replace("REPLACEMENT\n", "").strip())

        return (
            <>
                <Badge
                    size="xl"
                    variant="gradient"
                    gradient={message["role"] ? { from: 'blue', to: 'cyan', deg: 90 } : {from: 'red', to: 'orange', deg: 90}}
                >
                    Assistant: Text Replacement
                </Badge>
                <Text style={{fontWeight: "bold"}}>Filepath: {parsedContent["filepath"]}</Text>
                <ReactDiffViewer oldValue={parsedContent["original_text"]} newValue={parsedContent["new_text"]}/>
                <Button>Replace</Button>
            </>
        )
    }


    return (
        <>
            <Badge
                size="xl"
                variant="gradient"
                gradient={message["role"] ? { from: 'blue', to: 'cyan', deg: 90 } : {from: 'red', to: 'orange', deg: 90}}
            >
            {message["role"]}
            </Badge>
            
            <Badge
                size="md"
                color={hidden ? "gray": "blue"}
                onClick={unhide}
            >
                {hidden ? "Click to unhide" : "Click to hide"}
            </Badge>

            <details>
                <summary>{message["content"].split("\n")[0]}</summary>
                <Markdown
                    children={message["content"]}
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
                                    <CopyToClipboard text={String(children).replace(/\n$/, '')}>
                                        <Box>
                                            <Text size="xs">Click to copy</Text>
                                            <SyntaxHighlighter
                                                {...rest}
                                                children={String(children).replace(/\n$/, '')}
                                                style={dark}
                                                language={match[1]}
                                                PreTag="div"
                                            />
                                        </Box>
                                    </CopyToClipboard>

                                </Box>
                            ) : (
                            <code {...rest} className={className}>
                                {children}
                            </code>
                            )
                        }
                    }}
                />
            </details>
        </>
    );
}