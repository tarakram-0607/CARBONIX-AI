/**
 * chatbot.js — Smart, Strict Sustainability Chatbot
 *
 * Features:
 *  - STRICT topic guard: rejects all non-sustainability queries firmly
 *  - PERSONALIZED: reads window.currentMonthData & window.userProfile to give data-driven responses
 *  - CONTEXT MEMORY: tracks last 5 user messages for follow-up handling
 *  - RICH KNOWLEDGE BASE: 40+ response templates from engine.js
 *  - TYPING INDICATOR: shows animated dots before response
 *  - SUGGESTIONS CHIPS: quick-access question buttons
 */

import {
    CHATBOT_KEYWORDS,
    CHATBOT_REJECTION_PHRASES,
    CHATBOT_KNOWLEDGE
} from "./engine.js";

document.addEventListener('DOMContentLoaded', () => {
    const chatbotToggle   = document.getElementById('chatbot-toggle');
    const chatbotWindow   = document.getElementById('chatbot-window');
    const chatbotClose    = document.getElementById('chatbot-close');
    const chatbotInput    = document.getElementById('chatbot-input-field');
    const chatbotSend     = document.getElementById('chatbot-send');
    const messagesContainer = document.getElementById('chatbot-messages');

    if (!chatbotToggle || !chatbotWindow) return;

    // Session conversation memory (last 5 user messages)
    const sessionMemory = [];
    const MAX_MEMORY = 5;

    // Topic categories detected in last exchange (for follow-up handling)
    let lastTopics = [];

    // -----------------------------------------------------------------------
    // Toggle visibility
    // -----------------------------------------------------------------------
    const toggleChat = () => {
        chatbotWindow.classList.toggle('hidden');
        if (!chatbotWindow.classList.contains('hidden')) {
            chatbotInput.focus();
        }
    };
    chatbotToggle.addEventListener('click', toggleChat);
    chatbotClose?.addEventListener('click', toggleChat);

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------
    const appendMessage = (text, isUser = false, isHTML = false) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg ${isUser ? 'user-msg' : 'bot-msg'} fade-in`;

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';

        if (isHTML) {
            // Convert simple **bold** markdown to <strong>
            bubble.innerHTML = text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');
        } else {
            bubble.textContent = text;
        }

        msgDiv.appendChild(bubble);
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return msgDiv;
    };

    const showTypingIndicator = () => {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'msg bot-msg fade-in';
        typingDiv.id = 'typing-indicator';
        typingDiv.innerHTML = `
            <div class="msg-bubble typing-dots">
                <span></span><span></span><span></span>
            </div>`;
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const removeTypingIndicator = () => {
        document.getElementById('typing-indicator')?.remove();
    };

    // -----------------------------------------------------------------------
    // Topic classifier — strict + smart
    // -----------------------------------------------------------------------
    const isSustainabilityQuery = (text) => {
        const lower = text.toLowerCase();
        return CHATBOT_KEYWORDS.some(kw => lower.includes(kw));
    };

    const detectTopics = (text) => {
        const lower = text.toLowerCase();
        const topics = [];
        if (/electr|power|kwh|energy|light|applian|solar/.test(lower)) topics.push('electricity');
        if (/trav|car|bus|train|commut|flight|cycl|walk|transport/.test(lower)) topics.push('travel');
        if (/food|diet|meat|vegan|vegetar|eat|beef|chicken|plant/.test(lower)) topics.push('food');
        if (/goal|target|10%|achiev|progress|badge/.test(lower)) topics.push('goal');
        if (/trend|histor|month|pattern|increas|decreas/.test(lower)) topics.push('trend');
        if (/tip|advice|how|what|suggest|recommend|improve|reduce|lower|cut/.test(lower)) topics.push('general');
        return topics;
    };

    const isFollowUp = (text) => {
        const lower = text.toLowerCase();
        return /more|another|else|follow|next|and|also|additional|what about|anything/.test(lower);
    };

    // -----------------------------------------------------------------------
    // Response generator — personalized & context-aware
    // -----------------------------------------------------------------------
    const generateResponse = (text) => {
        const userContext = {
            current: window.currentMonthData || {},
            profile: window.userProfile      || {}
        };

        // Strict topic guard
        if (!isSustainabilityQuery(text)) {
            const randIdx = Math.floor(Math.random() * CHATBOT_REJECTION_PHRASES.length);
            return { text: CHATBOT_REJECTION_PHRASES[randIdx], isHTML: false };
        }

        const topics = detectTopics(text);

        // Follow-up: use remembered topics if this is a vague follow-up
        if (isFollowUp(text) && topics.length === 0 && lastTopics.length > 0) {
            topics.push(...lastTopics);
        }

        // Remember topics for next exchange
        if (topics.length > 0) lastTopics = topics;

        // Build response from knowledge base
        const responseParts = [];

        for (const topic of topics) {
            if (CHATBOT_KNOWLEDGE[topic]) {
                responseParts.push(CHATBOT_KNOWLEDGE[topic](userContext));
            }
        }

        // If no specific topic matched but it's sustainability-related
        if (responseParts.length === 0) {
            responseParts.push(CHATBOT_KNOWLEDGE.general(userContext));
        }

        // Add personalized proactive insight if we have user data
        if (userContext.current.total > 0 && topics.length === 1 && topics[0] !== 'general') {
            const proactive = buildProactiveInsight(userContext);
            if (proactive) responseParts.push(proactive);
        }

        return { text: responseParts.join('\n\n'), isHTML: true };
    };

    // Builds a short personalized insight appended to relevant responses
    const buildProactiveInsight = (ctx) => {
        const { current, profile } = ctx;
        if (!current.total) return null;

        const insights = [];

        // If user has data and is above global baseline
        const GLOBAL_BASELINE = 340;
        if (current.total > GLOBAL_BASELINE) {
            insights.push(`💡 **Quick insight:** Your current total (${current.total} kg) is ${(((current.total - GLOBAL_BASELINE) / GLOBAL_BASELINE) * 100).toFixed(0)}% above the average baseline of ${GLOBAL_BASELINE} kg.`);
        }

        // If we have profile trend info
        if (profile.trend === 'increasing' && profile.recordCount > 1) {
            insights.push(`⚠️ **Trend alert:** Your emissions have been increasing over the past ${profile.recordCount} months. Now is a great time to act.`);
        }

        return insights.length > 0 ? insights.join(' ') : null;
    };

    // -----------------------------------------------------------------------
    // Send flow with typing indicator
    // -----------------------------------------------------------------------
    const handleSend = () => {
        const text = chatbotInput.value.trim();
        if (!text) return;

        // Add to session memory
        sessionMemory.push(text);
        if (sessionMemory.length > MAX_MEMORY) sessionMemory.shift();

        appendMessage(text, true);
        chatbotInput.value = '';

        // Show typing dots
        showTypingIndicator();

        // Simulate realistic typing delay (600–1100ms)
        const delay = 600 + Math.random() * 500;
        setTimeout(() => {
            removeTypingIndicator();
            const response = generateResponse(text);
            appendMessage(response.text, false, response.isHTML);

            // Show follow-up suggestion chips after bot responds
            showSuggestionChips();
        }, delay);
    };

    chatbotSend?.addEventListener('click', handleSend);
    chatbotInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });

    // -----------------------------------------------------------------------
    // Quick-question chips (shown after first bot response)
    // -----------------------------------------------------------------------
    const QUICK_QUESTIONS = [
        'How can I reduce electricity?',
        'What is my highest emission source?',
        'Am I on track for my goal?',
        'How does my trend look?',
        'Tips to reduce travel emissions?',
        'How does food impact my footprint?'
    ];

    let chipsShown = false;
    const showSuggestionChips = () => {
        if (chipsShown) return;
        chipsShown = true;

        const chipsDiv = document.createElement('div');
        chipsDiv.className = 'suggestion-chips fade-in';
        chipsDiv.innerHTML = QUICK_QUESTIONS.map(q =>
            `<button class="chip" data-q="${q}">${q}</button>`
        ).join('');

        messagesContainer.appendChild(chipsDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        chipsDiv.querySelectorAll('.chip').forEach(btn => {
            btn.addEventListener('click', () => {
                chatbotInput.value = btn.dataset.q;
                handleSend();
                chipsDiv.remove();
                chipsShown = false;
            });
        });
    };
});
