import { loadHolidaySet } from "@/lib/dashboard/business-days";
import {
  getUserPreferences,
  getUserPreferencesByIds,
  listUserPersonalHolidays,
  listUserPersonalHolidaysByIds,
  type UserPersonalHolidayRow,
  type UserPreferencesRow,
} from "@/lib/db/operations";
import type { HolidayCalendarCode } from "@/lib/holidays/constants";
import {
  expandPersonalHolidayDates,
  type PersonalHoliday,
} from "@/lib/user/time-settings";

type PersonalHolidayLoaderOptions = {
  organizationHolidayCodes: HolidayCalendarCode[];
  organizationHolidaySet: ReadonlySet<string>;
  preferencesMap?: Map<string, UserPreferencesRow>;
  personalHolidayMap?: Map<string, UserPersonalHolidayRow[]>;
};

function mapPersonalHolidayRow(row: UserPersonalHolidayRow): PersonalHoliday {
  return {
    id: row.id,
    label: row.label,
    startDate: row.startDate,
    endDate: row.endDate,
  };
}

export function createPersonalHolidaySetLoader(
  options: PersonalHolidayLoaderOptions,
): (userId: string | null | undefined) => Promise<ReadonlySet<string>> {
  const cache = new Map<string, Promise<ReadonlySet<string>>>();
  const holidaySetCache = new Map<string, Promise<ReadonlySet<string>>>();

  return async function getPersonalHolidaySet(
    userId: string | null | undefined,
  ): Promise<ReadonlySet<string>> {
    if (!userId) {
      return options.organizationHolidaySet;
    }

    const existing = cache.get(userId);
    if (existing) {
      return existing;
    }

    const loader = (async () => {
      const preferences =
        options.preferencesMap?.get(userId) ??
        (await getUserPreferences(userId));
      const preferredCodes = preferences?.holidayCalendarCodes?.length
        ? preferences.holidayCalendarCodes
        : options.organizationHolidayCodes;
      const uniqueCodes = Array.from(new Set(preferredCodes));
      const codesToLoad = uniqueCodes.length
        ? uniqueCodes
        : options.organizationHolidayCodes;

      const holidaySets = await Promise.all(
        codesToLoad.map((code) => {
          const cached = holidaySetCache.get(code);
          if (cached) {
            return cached;
          }
          const promise = loadHolidaySet(code);
          holidaySetCache.set(code, promise);
          return promise;
        }),
      );

      const combined = new Set<string>();
      for (const set of holidaySets) {
        for (const date of set) {
          combined.add(date);
        }
      }

      const personalRows =
        options.personalHolidayMap?.get(userId) ??
        (await listUserPersonalHolidays(userId));
      const personalEntries = personalRows.map(mapPersonalHolidayRow);
      const personalDates = expandPersonalHolidayDates(personalEntries);
      for (const date of personalDates) {
        combined.add(date);
      }

      const codesMatchOrganization =
        codesToLoad.length === options.organizationHolidayCodes.length &&
        codesToLoad.every((code) =>
          options.organizationHolidayCodes.includes(code),
        );

      if (personalDates.size === 0 && codesMatchOrganization) {
        return options.organizationHolidaySet;
      }

      return combined;
    })();

    cache.set(userId, loader);
    return loader;
  };
}

export async function loadPersonalHolidaySet(
  userId: string | null | undefined,
  options: PersonalHolidayLoaderOptions,
): Promise<ReadonlySet<string>> {
  const loader = createPersonalHolidaySetLoader(options);
  return loader(userId);
}

export async function loadPersonalHolidaySetsForUsers(
  userIds: readonly string[],
  options: PersonalHolidayLoaderOptions,
): Promise<Map<string, ReadonlySet<string>>> {
  const uniqueIds = Array.from(
    new Set(userIds.filter((id): id is string => Boolean(id))),
  );
  if (!uniqueIds.length) {
    return new Map();
  }

  const loaderOptions: PersonalHolidayLoaderOptions = {
    organizationHolidayCodes: options.organizationHolidayCodes,
    organizationHolidaySet: options.organizationHolidaySet,
    preferencesMap:
      options.preferencesMap ?? (await getUserPreferencesByIds(uniqueIds)),
    personalHolidayMap:
      options.personalHolidayMap ??
      (await listUserPersonalHolidaysByIds(uniqueIds)),
  };

  const loader = createPersonalHolidaySetLoader(loaderOptions);
  const entries = await Promise.all(
    uniqueIds.map(async (id) => [id, await loader(id)] as const),
  );
  return new Map(entries);
}

export type { PersonalHolidayLoaderOptions };
