

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSettings } from '../hooks/useSettings.ts';
import { processPrescription, pingAI, isApiKeyConfigured } from '../services/geminiService.ts';
import { getSativarUsers } from '../services/wpApiService.ts';
import type { ChatMessage, QuoteResult } from '../types.ts';
import { AlertTriangleIcon } from './icons.tsx';
import { Chat } from './Chat.tsx';

const getInitialMessages = (): ChatMessage[] => [
    {
        id: 'init-greeting',
        sender: 'ai',
        content: { type: 'text', text: 'Olá! Sou a Ísis, sua parceira de equipe virtual. Estou aqui para ajudar a gente a agilizar os orçamentos e tirar dúvidas. 😊' },
    },
    {
        id: 'init-actions',
        sender: 'ai',
        content: {
            type: 'actions',
            text: 'Como posso te ajudar agora?',
            actions: [
                { label: 'Analisar Receita', payload: 'start_quote' },
                { label: 'Consultar Associado', payload: 'start_user_lookup' },
                { label: 'Informações Gerais', payload: 'general_info' },
            ]
        }
    }
];


export const QuoteGenerator: React.FC = () => {
    const { settings, isLoaded, wooProducts, systemPrompt, wpConfig } = useSettings();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingAction, setLoadingAction] = useState<'file' | 'text' | null>(null);
    const [showSettingsWarning, setShowSettingsWarning] = useState(false);
    const [wpConfigMissing, setWpConfigMissing] = useState(false);
    const [apiKeyMissing, setApiKeyMissing] = useState(true); // Default to true until checked
    const [processingAction, setProcessingAction] = useState<{ messageId: string; payload: string } | null>(null);
    const [chatFlow, setChatFlow] = useState<'idle' | 'quote' | 'user_lookup'>('idle');
    const initialMessageSent = useRef(false);

    // This effect runs once settings are loaded to initialize component state
    useEffect(() => {
        if (!isLoaded) return;

        // Add a check for the API_KEY to ensure it's configured
        setApiKeyMissing(!isApiKeyConfigured());
        
        // Check for WP config
        if (!wpConfig || !wpConfig.url) {
            setWpConfigMissing(true);
        } else {
            setWpConfigMissing(false);
        }

        // Set initial greeting message once settings are loaded
        if (!initialMessageSent.current) {
            setMessages(getInitialMessages());
            initialMessageSent.current = true;
        }
        
        // Check for settings completeness
        if (settings.associationName.includes("[Insira") || settings.pixKey.includes("[Insira")) {
             setShowSettingsWarning(true);
        } else {
            setShowSettingsWarning(false);
        }
    }, [isLoaded, settings, wpConfig]);


    const handleAction = useCallback(async (messageId: string, payload: string) => {
        const actionMessage = messages.find(m => m.id === messageId);
        if (!actionMessage || actionMessage.content.type !== 'actions') return;

        setProcessingAction({ messageId, payload });
        // Brief delay to allow UI to update and show the visual effect
        await new Promise(resolve => setTimeout(resolve, 300));

        const actionLabel = actionMessage.content.actions.find(a => a.payload === payload)?.label || 'Minha escolha';

        const userResponseMessage: ChatMessage = {
            id: `user-action-${Date.now()}`,
            sender: 'user',
            content: { type: 'text', text: actionLabel },
            isActionComplete: true,
        };
        
        // Replace action message with user's choice and add follow-ups
        setMessages(prevMessages => {
            const newMessages = prevMessages.filter(m => m.id !== messageId);
            newMessages.push(userResponseMessage);

            let followUpMessages: ChatMessage[] = [];
            switch (payload) {
                case 'start_quote':
                    setChatFlow('quote');
                    followUpMessages.push({
                        id: `ai-resp-${Date.now()}`, sender: 'ai',
                        content: { type: 'text', text: 'Ótimo! Por favor, anexe o arquivo da receita (imagem ou PDF) no campo abaixo para eu analisar.' },
                    });
                    break;
                case 'start_user_lookup':
                    setChatFlow('user_lookup');
                    followUpMessages.push({
                        id: `ai-resp-${Date.now()}`, sender: 'ai',
                        content: { type: 'text', text: 'Certo! Por favor, digite o nome, CPF ou e-mail do associado que você deseja buscar.' },
                    });
                    break;
                case 'general_info':
                    setChatFlow('idle');
                    followUpMessages.push({
                        id: `ai-resp-${Date.now()}`, sender: 'ai',
                        content: {
                            type: 'actions', text: 'Claro! Sobre o que você gostaria de saber?',
                            actions: [
                                { label: 'Produtos disponíveis', payload: 'info_products' },
                                { label: 'Horário de funcionamento', payload: 'info_hours' },
                                { label: 'Formas de pagamento', payload: 'info_payment' },
                                { label: 'Outra dúvida', payload: 'info_other' },
                            ]
                        }
                    });
                    break;
                case 'info_products':
                    {
                        const productsList = wooProducts.length > 0 ? wooProducts : settings.products;
                        let responseText = 'Não encontrei produtos cadastrados no momento. Por favor, consulte um de nossos atendentes.';
                        if (productsList.length > 0) {
                            responseText = 'Aqui estão os produtos que trabalhamos atualmente:\n\n' +
                                productsList.map(p => `• *${p.name}* - R$ ${p.price}`).join('\n');
                        }
                        followUpMessages.push({
                            id: `ai-resp-${Date.now()}`, sender: 'ai',
                            content: { type: 'text', text: responseText }
                        });
                    }
                    break;
                case 'info_hours':
                    followUpMessages.push({
                        id: `ai-resp-${Date.now()}`, sender: 'ai',
                        content: { type: 'text', text: `Nosso horário de funcionamento é: ${settings.operatingHours || 'Não informado.'}` }
                    });
                    break;
                case 'info_payment':
                    followUpMessages.push({
                        id: `ai-resp-${Date.now()}`, sender: 'ai',
                        content: { type: 'text', text: `O pagamento pode ser feito via PIX. A chave é o CNPJ: ${settings.pixKey || 'Não informado.'}` }
                    });
                    break;
                case 'info_other':
                    followUpMessages.push({
                        id: `ai-resp-${Date.now()}`, sender: 'ai',
                        content: { type: 'text', text: 'Sem problemas. Por favor, digite sua pergunta que eu tentarei responder.' }
                    });
                    break;
            }
            return [...newMessages, ...followUpMessages];
        });
        
        setProcessingAction(null);

    }, [messages, settings, wooProducts]);

    const handleSend = useCallback(async ({ text, file }: { text: string; file: File | null }) => {
        if (file) {
            setChatFlow('quote');
            await handleSendFile(file);
        } else if (text.trim()) {
            if (chatFlow === 'user_lookup') {
                await handleUserLookup(text);
            } else {
                await handleSendText(text);
            }
        }
    }, [systemPrompt, showSettingsWarning, apiKeyMissing, wpConfigMissing, chatFlow, wpConfig]);
    
    const handleSendFile = useCallback(async (file: File) => {
        if (showSettingsWarning || apiKeyMissing || wpConfigMissing) return;

        const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            sender: 'user',
            content: { type: 'file_request', fileName: file.name },
        };
        const loadingMessage: ChatMessage = {
            id: `ai-loading-${Date.now()}`,
            sender: 'ai',
            content: { type: 'loading' },
        };

        setMessages(prev => [...prev, userMessage, loadingMessage]);
        setIsLoading(true);
        setLoadingAction('file');

        try {
            const result = await processPrescription(file, systemPrompt);
            const resultMessage: ChatMessage = {
                id: `ai-result-${Date.now()}`,
                sender: 'ai',
                content: { type: 'quote', result },
            };
            setMessages(prev => [...prev.slice(0, -1), resultMessage]);
        } catch (err) {
            const errorMessage: ChatMessage = {
                id: `ai-error-${Date.now()}`,
                sender: 'ai',
                content: { type: 'error', message: err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.' },
            };
            setMessages(prev => [...prev.slice(0, -1), errorMessage]);
        } finally {
            setIsLoading(false);
            setLoadingAction(null);
            setChatFlow('idle');
        }
    }, [systemPrompt, showSettingsWarning, apiKeyMissing, wpConfigMissing]);
    
    const handleUserLookup = useCallback(async (searchText: string) => {
        if (wpConfigMissing || !wpConfig) return;

        const userMessage: ChatMessage = {
            id: `user-lookup-${Date.now()}`,
            sender: 'user',
            content: { type: 'text', text: searchText },
        };
        const loadingMessage: ChatMessage = {
            id: `ai-loading-${Date.now()}`,
            sender: 'ai',
            content: { type: 'loading' },
        };

        setMessages(prev => [...prev, userMessage, loadingMessage]);
        setIsLoading(true);
        setLoadingAction('text');

        try {
            const users = await getSativarUsers(wpConfig, searchText);
            const resultMessage: ChatMessage = {
                id: `ai-user-result-${Date.now()}`,
                sender: 'ai',
                content: { type: 'user_result', users, searchTerm: searchText },
            };
            const followUpMessage: ChatMessage = {
                id: `ai-follow-up-${Date.now()}`,
                sender: 'ai',
                content: {
                    type: 'actions',
                    text: 'Posso ajudar com mais alguma coisa?',
                    actions: [
                        { label: 'Analisar Receita', payload: 'start_quote' },
                        { label: 'Nova Consulta de Associado', payload: 'start_user_lookup' },
                        { label: 'Informações Gerais', payload: 'general_info' },
                    ]
                }
            };
            setMessages(prev => [...prev.slice(0, -1), resultMessage, followUpMessage]);
        } catch (err) {
            const errorMessage: ChatMessage = {
                id: `ai-error-${Date.now()}`,
                sender: 'ai',
                content: { type: 'error', message: err instanceof Error ? err.message : 'Ocorreu um erro ao buscar o associado.' },
            };
            setMessages(prev => [...prev.slice(0, -1), errorMessage]);
        } finally {
            setIsLoading(false);
            setLoadingAction(null);
            setChatFlow('idle');
        }
    }, [wpConfig, wpConfigMissing]);


    const handleSendText = useCallback(async (text: string) => {
        const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            sender: 'user',
            content: { type: 'text', text },
        };
        const loadingMessage: ChatMessage = {
            id: `ai-loading-${Date.now()}`,
            sender: 'ai',
            content: { type: 'loading' },
        };

        setMessages(prev => [...prev, userMessage, loadingMessage]);
        setIsLoading(true);
        setLoadingAction('text');
        
        try {
            const result = await pingAI(text, showSettingsWarning);
            const aiMessage: ChatMessage = {
                id: `ai-text-${Date.now()}`,
                sender: 'ai',
                content: { type: 'text', text: result },
            };
            setMessages(prev => [...prev.slice(0, -1), aiMessage]);
        } catch (err) {
            const errorMessage: ChatMessage = {
                id: `ai-error-${Date.now()}`,
                sender: 'ai',
                content: { type: 'error', message: err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.' },
            };
            setMessages(prev => [...prev.slice(0, -1), errorMessage]);
        } finally {
            setIsLoading(false);
            setLoadingAction(null);
        }
    }, [showSettingsWarning]);

    const handleResetChat = useCallback(() => {
        setMessages(getInitialMessages());
        setChatFlow('idle');
    }, []);

    const isChatDisabled = showSettingsWarning || apiKeyMissing || wpConfigMissing;
    let disabledReason = "";
    if (apiKeyMissing) {
        disabledReason = "Ação necessária: A Chave da API do Gemini não foi configurada no ambiente.";
    } else if (wpConfigMissing) {
        disabledReason = "Ação necessária: Configure a API do Sativar_WP_API nas Configurações.";
    } else if (showSettingsWarning) {
        disabledReason = "Complete as configurações da associação para habilitar o envio de receitas.";
    }

    return (
        <div className="flex h-full flex-col">
            {apiKeyMissing && (
                <div className="flex-shrink-0 p-2">
                    <div className="mx-auto max-w-4xl rounded-md bg-red-900/50 p-3 text-sm text-red-300 flex items-start gap-3 border border-red-700/50">
                        <AlertTriangleIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold">Ação Necessária: Chave da API do Gemini ausente</p>
                            <p className="mt-1">
                                A aplicação está em modo de funcionalidade limitada. Para habilitar a análise de receitas, um administrador deve configurar a variável de ambiente <code>VITE_GEMINI_API_KEY</code> no painel de controle do ambiente de hospedagem.
                            </p>
                        </div>
                    </div>
                </div>
            )}
            {(wpConfigMissing && !apiKeyMissing) && (
                 <div className="flex-shrink-0 p-2">
                    <div className="mx-auto max-w-4xl rounded-md bg-yellow-900/50 p-3 text-sm text-yellow-300 flex items-center gap-3 border border-yellow-700/50">
                        <AlertTriangleIcon className="h-5 w-5 flex-shrink-0" />
                        <span>A conexão com o sistema Sativar_WP_API ainda não foi configurada. Visite a página de 'Configurações' para habilitar a integração.</span>
                    </div>
                </div>
            )}
            
            <Chat 
                messages={messages}
                onSend={handleSend}
                isLoading={isLoading}
                disabled={isChatDisabled}
                disabledReason={disabledReason}
                loadingAction={loadingAction}
                onAction={handleAction}
                processingAction={processingAction}
                onResetChat={handleResetChat}
            />
        </div>
    );
};
