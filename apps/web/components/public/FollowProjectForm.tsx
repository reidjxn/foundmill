"use client";
/**
 * The public page's "Follow" form (package 1.6), wired: the design system's `ProjectFollowForm` with the Server Action
 * and the state `useActionState` keeps. Before JavaScript loads (or without it) the form posts to the same action and
 * the page comes back with the answer, so a visitor on a slow phone can follow too.
 */
import { useActionState } from "react";
import { ProjectFollowForm, type ProjectFollowFormProps, type ProjectFollowState } from "@foundmill/dugout";
import { followProject } from "@/app/p/[slug]/actions";

const IDLE: ProjectFollowState = { status: "idle" };

export function FollowProjectForm({ name, slug, builtOn = null }: { name: string; slug: string; builtOn?: ProjectFollowFormProps["builtOn"] }) {
  const [state, action, pending] = useActionState(followProject, IDLE);
  return <ProjectFollowForm name={name} slug={slug} action={action} state={state} pending={pending} builtOn={builtOn} />;
}
