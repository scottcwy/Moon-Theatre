# Aggregate the chat list by character

The user-facing chat list contains exactly one Character Chat Entry for each user and character, backed by a server-produced character summary whose default target is the most recently updated mode session. Script and free Chat Sessions, Visible History, Generation Context, and Script Memory remain separate; aggregation is only a navigation and summary concern, because deduplicating paginated session rows in the client would make uniqueness and pagination incorrect.
