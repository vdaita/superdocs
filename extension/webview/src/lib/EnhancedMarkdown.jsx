import React, { useState } from 'react'
import ReactDom from 'react-dom'
import Markdown from 'react-markdown'
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter'
import {dark} from 'react-syntax-highlighter/dist/esm/styles/prism'
import {Box, Group, Button, Text, Badge} from "@mantine/core";
import { VSCodeMessage } from './VSCodeMessage'
import {CopyToClipboard} from 'react-copy-to-clipboard';

export default function EnhancedMarkdown({ message }) {

    console.log("Received message in EnhancedMarkdown: ", message);

    if(!message.content){
        return (<>Empty message</>)
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
            

            <details>
                <summary>{message["content"].split("\n")[0]}</summary>
                <Markdown
                    children={message["content"]}
                    components={{
                        code(props) {
                            const {children, className, node, ...rest} = props
                            const match = /language-(\w+)/.exec(className || '')
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