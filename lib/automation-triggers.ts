export type CommentTriggerScope = {
  postId: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
};

export function hasCommentTrigger(scope: CommentTriggerScope): boolean {
  return Boolean(scope.postId || scope.matchAnyPost || scope.pendingNextReel);
}
