"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ReauthModalProps = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ReauthModal({ open, onConfirm, onCancel }: ReauthModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <Card className="w-full max-w-md border-border/70 shadow-lg">
        <CardHeader>
          <CardTitle>재인증 필요</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            보안을 위해 다시 sign in 해주세요.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel}>
              취소
            </Button>
            <Button onClick={onConfirm}>다시 sign in</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
