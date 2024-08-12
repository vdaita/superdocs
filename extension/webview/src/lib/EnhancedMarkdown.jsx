import React, { useState } from 'react'
import ReactDom from 'react-dom'
import Markdown from 'react-markdown'
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter'
import {dark} from 'react-syntax-highlighter/dist/esm/styles/prism'
import {Box, Group, Button, Text, Badge, ScrollArea} from "@mantine/core";
import { VSCodeMessage } from './VSCodeMessage'
import {CopyToClipboard} from 'react-copy-to-clipboard';
import { searchReplaceFormatSingleFile } from './diff'

export default function EnhancedMarkdown({ message, height, fileSnippets }) {

    console.log("Received message in EnhancedMarkdown: ", message);

    let diffWrite = (item, fileString) => {
        VSCodeMessage.postMessage({
            type: "writeFile",
            content: {
              filepath: item.filepath,
              code: searchReplaceFormatSingleFile(item.code, fileString)
            }
        });
    }

    let regularWrite = (item, fileStr) => {
          VSCodeMessage.postMessage({
            type: "writeFile",
            content: {
              filepath: item.filepath,
              code: fileStr
            }
          });
    }

    return (
        <Markdown
            style={{height: height, overflowY: 'scroll'}}
            children={message}
            components={{
                code(props) {
                    const {children, className, node, ...rest} = props
                    const match = /language-(\w+)/.exec(className || '')
                    if ( String(children).replace(/\n$/, '').length  < 50) {
                        return (
                            <code>
                                {String(children).replace(/\n$/, '')}
                            </code>
                        )
                    }
                    return (
                        
                        <Box>
                            <CopyToClipboard text={String(children).replace(/\n$/, '')}>
                                <Box>
                                    <Text size="xs">Click to copy</Text>
                                    <SyntaxHighlighter
                                        {...rest}
                                        children={String(children).replace(/\n$/, '')}
                                        style={dark}
                                        // language={match[1]}
                                        PreTag="div"
                                    />
                                </Box>
                            </CopyToClipboard>
                            {(fileSnippets.length > 0) && <ScrollArea>
                                    <Group>
                                        {fileSnippets.map((item) => (
                                            <>
                                                <Button onClick={() => diffWrite(item, String(children).replace(/\n$/, ''))}>Diff: {item.filepath}</Button>
                                                <Button onClick={() => regularWrite(item, String(children).replace(/\n$/, ''))}>Write: {item.filepath}</Button>
                                            </>
                                        ))}
                                    </Group>
                                </ScrollArea>}
                        </Box>
    )
                }
            }}
        />
    );
}