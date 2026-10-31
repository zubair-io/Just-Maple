import type { TodayFeed, TodaySection, AssistanceStatus } from '@maple/shared';
import { findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import { todayActions, todayFollowUps } from '../repositories/today.repo';
import { listAssistanceTasks, taskView } from '../repositories/assistance.repo';
import { visibleFollowUpsInNotebook } from './follow-up.service';
import { getActivityItem } from './bot-activity.service';
import { AssistanceError } from './assistance-access.service';
import { findPageById } from '../repositories/page.repo';

export async function todayFeed(
    userId: string,
    notebookId: string,
    section: TodaySection,
    cursors: { followBefore?: string; actionBefore?: string; taskBefore?: string },
    limit = 20,
): Promise<TodayFeed> {
    if (!(await findNotebookByIdWithAccess(notebookId, userId, 'read')))
        throw new AssistanceError(404, 'Notebook not found.');
    const statuses: AssistanceStatus[] =
        section === 'working'
            ? ['pending', 'running']
            : section === 'needs-you'
              ? ['failed', 'interrupted']
              : section === 'recent'
                ? ['completed', 'cancelled']
                : [];
    const [followRows, actionRows, taskRows] = await Promise.all([
        todayFollowUps(userId, section, cursors.followBefore, limit),
        todayActions(userId, notebookId, section, cursors.actionBefore, limit),
        statuses.length
            ? listAssistanceTasks(
                  userId,
                  { notebookId, statuses, before: cursors.taskBefore },
                  limit + 1,
              )
            : Promise.resolve([]),
    ]);
    const followUps = await visibleFollowUpsInNotebook(
        notebookId,
        userId,
        followRows.slice(0, limit),
    );
    const actions = (
        await Promise.all(actionRows.slice(0, limit).map((row) => getActivityItem(row._id, userId)))
    ).filter(
        (row): row is NonNullable<typeof row> =>
            row !== null && (section !== 'review' || ['proposed', 'opened'].includes(row.status)),
    );
    const tasks = (
        await Promise.all(
            taskRows.slice(0, limit).map(async (row) => {
                const source = await findPageById(row.pageId, userId);
                return source && !source.isTrashed && source.notebookId === notebookId
                    ? taskView(row)
                    : null;
            }),
        )
    ).filter((row) => row !== null);
    return {
        followUps,
        actions,
        tasks,
        ...(followRows.length > limit ? { nextFollowUp: followRows[limit - 1]!._id } : {}),
        ...(actionRows.length > limit ? { nextAction: actionRows[limit - 1]!._id } : {}),
        ...(taskRows.length > limit ? { nextTask: taskRows[limit - 1]!._id } : {}),
    };
}
