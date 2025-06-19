import { useQuery } from '@tanstack/react-query';
import {
  BotIcon,
  ChevronRightIcon,
  Gift,
  Loader2Icon,
  LockIcon,
  SendIcon,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import TextareaAutosize from 'react-textarea-autosize';
import { useToast } from '../../hooks/use-toast';
import { readStream } from '../../lib/ai';
import { cn } from '../../lib/classname';
import { isLoggedIn, removeAuthToken } from '../../lib/jwt';
import { markdownToHtmlWithHighlighting } from '../../lib/markdown';
import { getPercentage } from '../../lib/number';
import { showLoginPopup } from '../../lib/popup';
import type { ResourceType } from '../../lib/resource-progress';
import { getAiCourseLimitOptions } from '../../queries/ai-course';
import { billingDetailsOptions } from '../../queries/billing';
import { roadmapTreeMappingOptions } from '../../queries/roadmap-tree';
import { queryClient } from '../../stores/query-client';
import {
  AIChatCard,
  type AIChatHistoryType,
} from '../GenerateCourse/AICourseLessonChat';
import '../GenerateCourse/AICourseLessonChat.css';
import { AILimitsPopup } from '../GenerateCourse/AILimitsPopup';
import { PredefinedActions, promptLabelMapping } from './PredefinedActions';
import { defaultChatHistory } from './TopicDetail';

type TopicDetailAIProps = {
  resourceId: string;
  resourceType: ResourceType;
  topicId: string;

  hasUpgradeButtons?: boolean;

  aiChatHistory: AIChatHistoryType[];
  setAiChatHistory: (history: AIChatHistoryType[]) => void;

  onUpgrade: () => void;
  onLogin: () => void;

  onShowSubjectSearchModal: () => void;
};

export function TopicDetailAI(props: TopicDetailAIProps) {
  const {
    aiChatHistory,
    setAiChatHistory,
    resourceId,
    resourceType,
    topicId,
    hasUpgradeButtons = true,
    onUpgrade,
    onLogin,
    onShowSubjectSearchModal,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollareaRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const sanitizedTopicId = topicId?.includes('@')
    ? topicId?.split('@')?.[1]
    : topicId;

  const toast = useToast();
  const [message, setMessage] = useState('');
  const [isStreamingMessage, setIsStreamingMessage] = useState(false);
  const [streamedMessage, setStreamedMessage] = useState('');
  const [showAILimitsPopup, setShowAILimitsPopup] = useState(false);
  const { data: tokenUsage, isLoading } = useQuery(
    getAiCourseLimitOptions(),
    queryClient,
  );

  const { data: userBillingDetails, isLoading: isBillingDetailsLoading } =
    useQuery(billingDetailsOptions(), queryClient);

  const { data: roadmapTreeMapping, isLoading: isRoadmapTreeMappingLoading } =
    useQuery(
      {
        ...roadmapTreeMappingOptions(resourceId),
        select: (data) => {
          const node = data.find(
            (mapping) => mapping.nodeId === sanitizedTopicId,
          );
          return node;
        },
      },
      queryClient,
    );

  const isLimitExceeded = (tokenUsage?.used || 0) >= (tokenUsage?.limit || 0);
  const isPaidUser = userBillingDetails?.status === 'active';

  const handleChatSubmit = (overrideMessage?: string) => {
    const trimmedMessage = (overrideMessage ?? message).trim();

    if (
      !trimmedMessage ||
      isStreamingMessage ||
      !isLoggedIn() ||
      isLimitExceeded ||
      isLoading
    ) {
      return;
    }

    const newMessages: AIChatHistoryType[] = [
      ...aiChatHistory,
      {
        role: 'user',
        content: trimmedMessage,
      },
    ];

    flushSync(() => {
      setAiChatHistory(newMessages);
      setMessage('');
    });

    scrollToBottom();
    completeAITutorChat(newMessages);
  };

  const scrollToBottom = useCallback(() => {
    scrollareaRef.current?.scrollTo({
      top: scrollareaRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [scrollareaRef]);

  const completeAITutorChat = async (messages: AIChatHistoryType[]) => {
    try {
      setIsStreamingMessage(true);

      const response = await fetch(
        `${import.meta.env.PUBLIC_API_URL}/v1-topic-detail-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            resourceId,
            resourceType,
            topicId: sanitizedTopicId,
            messages: messages.slice(-10),
          }),
        },
      );

      if (!response.ok) {
        const data = await response.json();

        toast.error(data?.message || 'Something went wrong');
        setAiChatHistory([...messages].slice(0, messages.length - 1));
        setIsStreamingMessage(false);

        if (data.status === 401) {
          removeAuthToken();
          window.location.reload();
        }

        queryClient.invalidateQueries(getAiCourseLimitOptions());
        return;
      }

      const reader = response.body?.getReader();

      if (!reader) {
        setIsStreamingMessage(false);
        toast.error('Something went wrong');
        return;
      }

      await readStream(reader, {
        onStream: async (content) => {
          flushSync(() => {
            setStreamedMessage(content);
          });

          scrollToBottom();
        },
        onStreamEnd: async (content) => {
          const newMessages: AIChatHistoryType[] = [
            ...messages,
            {
              role: 'assistant',
              content,
              html: await markdownToHtmlWithHighlighting(content),
            },
          ];

          flushSync(() => {
            setStreamedMessage('');
            setIsStreamingMessage(false);
            setAiChatHistory(newMessages);
          });

          queryClient.invalidateQueries(getAiCourseLimitOptions());
          scrollToBottom();
        },
      });

      setIsStreamingMessage(false);
    } catch (error) {
      toast.error('Something went wrong');
      setIsStreamingMessage(false);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, []);

  const isDataLoading =
    isLoading || isBillingDetailsLoading || isRoadmapTreeMappingLoading;
  const usagePercentage = getPercentage(
    tokenUsage?.used || 0,
    tokenUsage?.limit || 0,
  );
  const hasChatHistory = aiChatHistory.length > 1;
  const nodeTextParts = roadmapTreeMapping?.text?.split('>') || [];
  const hasSubjects =
    (roadmapTreeMapping?.subjects &&
      roadmapTreeMapping?.subjects?.length > 0) ||
    nodeTextParts.length > 1;

  return (
    <div className="relative mt-4 flex grow flex-col overflow-hidden rounded-lg border border-gray-200">
      {isDataLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-white text-black">
          <Loader2Icon className="size-8 animate-spin stroke-3 text-gray-500" />
        </div>
      )}

      {showAILimitsPopup && (
        <AILimitsPopup
          onClose={() => setShowAILimitsPopup(false)}
          onUpgrade={() => {
            setShowAILimitsPopup(false);
            onUpgrade();
          }}
        />
      )}

      {hasSubjects && (
        <div className="border-b border-gray-200 p-3">
          <h4 className="flex items-center gap-2 text-sm">
            Complete the following AI Tutor courses
          </h4>

          <div className="mt-2.5 flex flex-wrap gap-1 text-sm">
            {roadmapTreeMapping?.subjects?.map((subject) => {
              return (
                <a
                  key={subject}
                  target="_blank"
                  onClick={(e) => {
                    if (!isLoggedIn()) {
                      e.preventDefault();
                      onLogin();
                      return;
                    }

                    if (isLimitExceeded) {
                      e.preventDefault();
                      onUpgrade();
                      return;
                    }
                  }}
                  href={`/ai/course?term=${subject}&difficulty=beginner&src=topic`}
                  className="flex items-center gap-1 gap-2 rounded-md border border-gray-300 bg-gray-100 px-2 py-1 hover:bg-gray-200 hover:text-black"
                >
                  {subject}
                </a>
              );
            })}

            {roadmapTreeMapping?.subjects?.length === 0 && (
              <a
                target="_blank"
                href={`/ai/course?term=${roadmapTreeMapping?.text}&difficulty=beginner&src=topic`}
                className="flex items-center gap-1 rounded-md border border-gray-300 bg-gray-100 px-2 py-1 hover:bg-gray-200 hover:text-black"
              >
                {nodeTextParts.slice(1).map((text, index) => {
                  // -2 because we are removing roadmap title from the list
                  const isLast = index === nodeTextParts.length - 2;

                  return (
                    <>
                      <span key={text} className="flex items-center">
                        {text}
                      </span>

                      {!isLast && (
                        <ChevronRightIcon className="h-3 w-3 text-gray-400" />
                      )}
                    </>
                  );
                })}
              </a>
            )}

            <button
              onClick={onShowSubjectSearchModal}
              className="flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 bg-transparent px-2 py-1 text-gray-400 hover:border-solid hover:bg-gray-200 hover:text-black"
            >
              <WandSparkles className="h-3 w-3" />
              Learn another topic
            </button>
          </div>
        </div>
      )}

      <div
        className={cn(
          'flex min-h-[46px] items-center justify-between gap-2 border-gray-200 px-3 py-2 text-sm',
        )}
      >
        {hasSubjects && (
          <span className="flex items-center gap-2 text-sm">
            <BotIcon
              className="relative -top-[1px] size-4 shrink-0 text-black"
              strokeWidth={2.5}
            />
            <span className="hidden sm:block">Chat with AI</span>
            <span className="block sm:hidden">AI Tutor</span>
          </span>
        )}

        {!hasSubjects && (
          <h4 className="flex items-center gap-2 text-base font-medium">
            <BotIcon
              className="relative -top-[1px] size-5 shrink-0 text-black"
              strokeWidth={2.5}
            />
            AI Tutor
          </h4>
        )}

        {!isDataLoading && (
          <div className="flex gap-1.5">
            {hasChatHistory && (
              <button
                className="rounded-md bg-white px-2 py-2 text-xs font-medium text-black hover:bg-gray-200"
                onClick={() => {
                  setAiChatHistory(defaultChatHistory);
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}

            {!isPaidUser && hasUpgradeButtons && (
              <>
                <button
                  className="hidden rounded-md bg-gray-200 px-2 py-1 text-sm hover:bg-gray-300 sm:block"
                  onClick={() => {
                    if (!isLoggedIn()) {
                      onLogin();
                      return;
                    }

                    setShowAILimitsPopup(true);
                  }}
                >
                  <span className="font-medium">{usagePercentage}%</span>{' '}
                  credits used
                </button>
                <button
                  className="flex items-center gap-1 rounded-md bg-yellow-400 px-2 py-1 text-sm text-black hover:bg-yellow-500"
                  onClick={() => {
                    if (!isLoggedIn()) {
                      onLogin();
                      return;
                    }

                    onUpgrade();
                  }}
                >
                  <Gift className="size-4" />
                  Upgrade
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <PredefinedActions
        onSelect={(action) => {
          if (!isLoggedIn()) {
            onLogin();
            return;
          }

          if (isLimitExceeded) {
            onUpgrade();
            return;
          }

          if (!action?.prompt) {
            toast.error('Something went wrong');
            return;
          }

          setMessage(action.prompt);
          handleChatSubmit(action.prompt);
        }}
      />

      <div
        className="scrollbar-thumb-gray-300 scrollbar-track-transparent scrollbar-thin relative grow overflow-y-auto"
        ref={scrollareaRef}
      >
        <div className="absolute inset-0 flex flex-col">
          <div className="relative flex grow flex-col justify-end">
            <div className="flex flex-col justify-end gap-2 px-3 py-2">
              {aiChatHistory.map((chat, index) => {
                let content = chat.content;

                if (chat.role === 'user' && promptLabelMapping[chat.content]) {
                  content = promptLabelMapping[chat.content];
                }

                return (
                  <Fragment key={`chat-${index}`}>
                    <AIChatCard
                      role={chat.role}
                      content={content}
                      html={chat.html}
                    />
                  </Fragment>
                );
              })}

              {isStreamingMessage && !streamedMessage && (
                <AIChatCard role="assistant" content="Thinking..." />
              )}

              {streamedMessage && (
                <AIChatCard role="assistant" content={streamedMessage} />
              )}
            </div>
          </div>
        </div>
      </div>

      <form
        ref={formRef}
        className="relative flex items-start border-t border-gray-200 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          handleChatSubmit();
        }}
      >
        {isLimitExceeded && isLoggedIn() && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black text-white">
            <LockIcon className="size-4 cursor-not-allowed" strokeWidth={2.5} />
            <p className="cursor-not-allowed">
              Limit reached for today
              {isPaidUser ? '. Please wait until tomorrow.' : ''}
            </p>
            {!isPaidUser && (
              <button
                onClick={onUpgrade}
                className="rounded-md bg-white px-2 py-1 text-xs font-medium text-black hover:bg-gray-300"
              >
                Upgrade for more
              </button>
            )}
          </div>
        )}

        {!isLoggedIn() && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black text-white">
            <LockIcon className="size-4 cursor-not-allowed" strokeWidth={2.5} />
            <p className="cursor-not-allowed">Please login to continue</p>
            <button
              onClick={() => {
                showLoginPopup();
              }}
              className="rounded-md bg-white px-2 py-1 text-xs font-medium text-black hover:bg-gray-300"
            >
              Login / Register
            </button>
          </div>
        )}

        {isDataLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black text-white">
            <Loader2Icon className="size-4 animate-spin" />
            <p>Loading...</p>
          </div>
        )}

        <TextareaAutosize
          className={cn(
            'h-full min-h-[41px] grow resize-none bg-transparent px-4 py-2 focus:outline-hidden',
          )}
          placeholder="Ask AI anything about the lesson..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          autoFocus={true}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleChatSubmit();
            }
          }}
          ref={textareaRef}
        />
        <button
          type="submit"
          disabled={isStreamingMessage || isLimitExceeded}
          className="flex aspect-square size-[41px] items-center justify-center text-zinc-500 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendIcon className="size-4 stroke-[2.5]" />
        </button>
      </form>
    </div>
  );
}
