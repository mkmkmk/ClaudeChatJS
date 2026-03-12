const PASSWORD = localStorage.getItem('chat_password');
if (!PASSWORD) {
    const pwd = prompt('Enter password to access chat:');
    if (!pwd) {
        alert('Password required!');
        throw new Error('No password provided');
    }
    localStorage.setItem('chat_password', pwd);
    location.reload();
}

function logout() {
    if (confirm('Logout and clear password?')) {
        localStorage.removeItem('chat_password');
        location.reload();
    }
}

const WORKER_URL = 'https://ant1.mariusz-krej.workers.dev';

const chatHistory = [];
let isProcessing = false;

// Auto-resize textarea
const input = document.getElementById('input');
input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});


function updateMessage(messageId, content) {
    const messageDiv = document.getElementById(messageId);
    if (!messageDiv) return;

    const contentDiv = messageDiv.querySelector('.message-content');
    if (!contentDiv) return;

    const html = marked.parse(content);
    contentDiv.innerHTML = DOMPurify.sanitize(html);

    // Renderuj LaTeX
    if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(contentDiv, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '\\$', right: '\\$', display: false},
                {left: '$', right: '$', display: false}
            ],
            throwOnError: false,
            strict: false
        });
    }

    // Highlight code
    // contentDiv.querySelectorAll('pre code').forEach((block) => {
    //     if (!block.textContent.includes('plotly-js'))
    //         hljs.highlightElement(block);
    // });
    contentDiv.querySelectorAll('pre code:not(.language-plotly-js)').forEach((block) => {
        hljs.highlightElement(block);
    });

    // Auto-scroll
    const chat = document.getElementById('chat');
    chat.scrollTop = chat.scrollHeight;
}

async function sendMessage() {
    if (isProcessing) return;
    
    const message = input.value.trim();
    if (!message) return;

    const sendBtn = document.getElementById('send');
    
    // Add user message
    addMessage('user', message);
    chatHistory.push({ role: 'user', content: message });
    
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
    isProcessing = true;

    // Show loading
    const loadingId = addMessage('assistant', '💭 Thinking', true);

    try {
        const response = await fetch(WORKER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('chat_password')}`
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4000,
                system: SYSTEM_PROMPT,
                messages: chatHistory
            })
        });

        if (response.status === 401) {
            localStorage.removeItem('chat_password');
            alert('Invalid password! Please refresh and try again.');
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        document.getElementById(loadingId).remove();

        // Streaming
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = '';
        let messageId = null;
        let buffer = '';

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);

                        if (parsed.type === 'content_block_delta') {
                            const text = parsed.delta?.text || '';
                            assistantMessage += text;

                            if (!messageId) {
                                messageId = addMessage('assistant', assistantMessage);
                            } else {
                                updateMessage(messageId, assistantMessage);
                            }
                        }
                    } catch (e) {
                        console.warn('SSE parse error:', e, 'Line:', line);
                    }
                }
            }
        }

        chatHistory.push({ role: 'assistant', content: assistantMessage });

        const plotlyBlocks = assistantMessage.match(/```plotly-js\n[\s\S]*?```/g);
        if (plotlyBlocks && plotlyBlocks.length > 0) {
            const contentDiv = document.getElementById(messageId).querySelector('.message-content');
            renderPlotlyInDOM(contentDiv);

            if (typeof renderMathInElement !== 'undefined') {
                renderMathInElement(contentDiv, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '\\$', right: '\\$', display: false},
                        {left: '$', right: '$', display: false}
                    ],
                    throwOnError: false
                });
            }
            contentDiv.querySelectorAll('pre code:not(.language-plotly-js)').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

    } catch (error) {
        document.getElementById(loadingId)?.remove();
        addMessage('assistant', '❌ Error: ' + error.message);
        console.error('Error:', error);
    } finally {
        sendBtn.disabled = false;
        isProcessing = false;
        input.focus();
    }

}

function renderPlotlyInDOM(contentDiv) {
    const codeBlocks = contentDiv.querySelectorAll('pre code.language-plotly-js');
    
    codeBlocks.forEach(codeBlock => {
        const code = codeBlock.textContent;
        const preElement = codeBlock.parentElement;
        const plotId = 'plot-' + Date.now() + Math.random();
        const plotDiv = document.createElement('div');
        plotDiv.id = plotId;
        plotDiv.style.width = '100%';
        plotDiv.style.height = '400px';
        preElement.replaceWith(plotDiv);

        try {
            let fixedCode = code;
                // .replace(/if\s*\([^)]+\)\s*{\s*;?\s*}/g, '')
                // .replace(/,(\s*[}\]])/g, '$1');
            
            console.log('=== Plotly Code ===');
            console.log(fixedCode);
            
            const plotConfig = new Function(fixedCode)();
            Plotly.newPlot(plotId, plotConfig.data, plotConfig.layout || {}, {
                    displayModeBar: false,
                    staticPlot: true
                });

        } catch (err) {
            console.error('Plotly error:', err);
            plotDiv.innerHTML = `<div style="color:red;">Error: ${err.message}</div>`;
        }
    });
}

function addMessage(role, content, isLoading = false) {
    const chat = document.getElementById('chat');
    const messageDiv = document.createElement('div');
    const id = 'msg-' + Date.now();

    messageDiv.id = id;
    messageDiv.className = `message ${role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (isLoading) {
        contentDiv.className += ' loading';
        contentDiv.textContent = content;
    } else {
        const html = marked.parse(content);
        contentDiv.innerHTML = DOMPurify.sanitize(html);
        renderMathInElement(contentDiv, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '\\$', right: '\\$', display: false},  // ze slashem
                {left: '$', right: '$', display: false}       // bez slasha
            ],
            throwOnError: false
        });
        contentDiv.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });                
    }

    messageDiv.appendChild(contentDiv);
    chat.appendChild(messageDiv);
    chat.scrollTop = chat.scrollHeight;

    return id;
}

function clearChat() {
    if (confirm('Clear entire conversation?')) {
        document.getElementById('chat').innerHTML = '';
        chatHistory.length = 0;
    }
}

function exportChatYAML() {
    if (chatHistory.length === 0) {
        alert('No conversation to export!');
        return;
    }

    const data = {
        session_id: 'web-' + Date.now(),
        conversation: chatHistory
    };
    
    const yaml = jsyaml.dump(data, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
    });
    
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const now = new Date();
    const timestamp = now.toISOString().slice(0,16).replace('T','_').replace(':','_');
    a.download = `chat_history_${timestamp}.yaml`;
    
    a.click();
    URL.revokeObjectURL(url);
}

function importChatYAML(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = jsyaml.load(e.target.result);
            
            if (!data.conversation || !Array.isArray(data.conversation)) {
                throw new Error('Invalid YAML format');
            }

            // Clear current chat
            chatHistory.length = 0;
            document.getElementById('chat').innerHTML = '';
            
            // Load conversation
            data.conversation.forEach(msg => {
                if (msg.role && msg.content) {
                    chatHistory.push({ role: msg.role, content: msg.content });
                    addMessage(msg.role, msg.content);
                }
            });

            console.log(`Imported ${chatHistory.length} messages from session: ${data.session_id}`);

        } catch (error) {
            alert('Error importing file: ' + error.message);
            console.error('Import error:', error);
        }
    };
    reader.readAsText(file);
    
    // Reset file input
    document.getElementById('fileInput').value = '';
}

// Event listeners
document.getElementById('send').onclick = sendMessage;

input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

// Focus input on load
input.focus();

// Welcome message
setTimeout(() => {
    addMessage('assistant', 'Cześć! Jestem Claude. W czym mogę pomóc?');
    if (false)
        console.log(SYSTEM_PROMPT);
}, 500);

window.addEventListener('beforeunload', (e) => {
    if (chatHistory.length > 0) {
        e.preventDefault();
        e.returnValue = ''; // Chrome wymaga tego
        return ''; // Inne przeglądarki
    }
});
