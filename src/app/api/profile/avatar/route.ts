import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { readActiveSession } from "@/lib/auth/session";
import { getUserProfiles, updateUserAvatarUrl } from "@/lib/db/operations";

const MAX_AVATAR_FILE_SIZE = 4 * 1024 * 1024; // 4MB
const ALLOWED_MIME_TYPES = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const UPLOAD_DIRECTORY = path.join(
  process.cwd(),
  "public",
  "uploads",
  "avatars",
);

function sanitizeFileNameSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function resolveAvatarPath(avatarUrl: string) {
  const relative = avatarUrl.startsWith("/") ? avatarUrl.slice(1) : avatarUrl;
  const normalized = path.normalize(relative);
  if (!normalized.startsWith("uploads/avatars")) {
    return null;
  }
  return path.join(process.cwd(), "public", normalized);
}

async function removeExistingAvatar(avatarUrl: string | null | undefined) {
  if (!avatarUrl) {
    return;
  }

  const filePath = resolveAvatarPath(avatarUrl);
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Failed to remove previous avatar", error);
    }
  }
}

async function getCurrentUserProfile(userId: string) {
  const profiles = await getUserProfiles([userId]);
  return profiles.find((profile) => profile.id === userId) ?? null;
}

export async function POST(request: Request) {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  let uploadedFilePath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get("avatar");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "업로드할 이미지를 선택해 주세요." },
        { status: 400 },
      );
    }

    if (file.size <= 0) {
      return NextResponse.json(
        { success: false, message: "빈 파일은 업로드할 수 없습니다." },
        { status: 400 },
      );
    }

    if (file.size > MAX_AVATAR_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          message: "최대 4MB 이하의 이미지만 업로드할 수 있습니다.",
        },
        { status: 400 },
      );
    }

    const normalizedType = (file.type || "").toLowerCase();
    let extension = ALLOWED_MIME_TYPES.get(normalizedType) ?? null;

    if (!extension) {
      const name = file.name ?? "";
      const candidate = name.split(".").pop()?.toLowerCase();
      if (candidate && ALLOWED_EXTENSIONS.has(candidate)) {
        extension = candidate === "jpeg" ? "jpg" : candidate;
      }
    }

    if (!extension) {
      return NextResponse.json(
        {
          success: false,
          message: "PNG, JPG, WebP 형식의 이미지만 업로드할 수 있습니다.",
        },
        { status: 400 },
      );
    }

    const safeId = sanitizeFileNameSegment(session.userId);
    const filename = `avatar-${safeId}-${Date.now()}.${extension}`;
    const targetPath = path.join(UPLOAD_DIRECTORY, filename);

    await fs.mkdir(UPLOAD_DIRECTORY, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(targetPath, buffer);
    uploadedFilePath = targetPath;

    const relativeUrl = `/uploads/avatars/${filename}`;

    const currentProfile = await getCurrentUserProfile(session.userId);
    const state = await updateUserAvatarUrl(session.userId, relativeUrl);
    await removeExistingAvatar(currentProfile?.avatarUrl ?? null);

    return NextResponse.json({
      success: true,
      result: state,
    });
  } catch (error) {
    console.error("Failed to upload avatar", error);
    if (uploadedFilePath) {
      try {
        await fs.unlink(uploadedFilePath);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error(
            "Failed to clean up temporary avatar file",
            cleanupError,
          );
        }
      }
    }
    return NextResponse.json(
      {
        success: false,
        message: "프로필 사진 업로드 중 문제가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const session = await readActiveSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const profile = await getCurrentUserProfile(session.userId);

    if (!profile || !profile.avatarUrl) {
      return NextResponse.json({ success: true });
    }

    const state = await updateUserAvatarUrl(session.userId, null);
    await removeExistingAvatar(profile.avatarUrl);

    return NextResponse.json({ success: true, result: state });
  } catch (error) {
    console.error("Failed to remove avatar", error);
    return NextResponse.json(
      {
        success: false,
        message: "프로필 사진을 제거하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
