package channels

import (
	"context"

	"github.com/fastclaw-ai/fastclaw/internal/bus"
)

// Channel is the interface that all channel implementations must satisfy.
type Channel interface {
	// Name returns the channel type identifier (e.g. "telegram").
	Name() string
	// AccountID returns the account identifier within the channel.
	AccountID() string
	// BotUsername returns the bot's username for this channel (e.g. "mike_fastclaw_bot").
	// Returns empty string if not applicable.
	BotUsername() string
	// Start begins listening for messages. It should block until ctx is cancelled.
	Start(ctx context.Context) error
	// Send sends a plain text message to the specified chat.
	Send(chatID string, text string) error
	// SendMessage sends a rich outbound message with formatting, reply-to, buttons, etc.
	SendMessage(msg bus.OutboundMessage) error
	// SendTyping sends a typing indicator to the specified chat.
	SendTyping(chatID string) error
}
