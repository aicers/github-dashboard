import {
  getRepositoryProfiles,
  getUserProfiles,
  type RepositoryProfile,
  type UserProfile,
} from "@/lib/db/operations";

export async function resolveProfiles(
  repositoryIds: string[],
  userIds: string[],
): Promise<{ repositories: RepositoryProfile[]; users: UserProfile[] }> {
  const [repositories, users] = await Promise.all([
    repositoryIds.length
      ? getRepositoryProfiles(repositoryIds)
      : Promise.resolve([]),
    userIds.length ? getUserProfiles(userIds) : Promise.resolve([]),
  ]);

  return { repositories, users };
}
