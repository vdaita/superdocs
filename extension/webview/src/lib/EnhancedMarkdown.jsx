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

    return (
        <Markdown
            children={message}
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
    );
}