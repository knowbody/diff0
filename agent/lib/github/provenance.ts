import type { GitHubRepositoryRef } from "eve/channels/github";
import { FACTORY_REPO, factoryRepo } from "../constants.js";

/** Whether a signed webhook was delivered for the one repository this factory owns. */
export function isFactoryRepository(repository: GitHubRepositoryRef): boolean {
  return (
    repository.owner.toLowerCase() === factoryRepo.owner.toLowerCase() &&
    repository.name.toLowerCase() === factoryRepo.repo.toLowerCase() &&
    repository.fullName.toLowerCase() === FACTORY_REPO.toLowerCase()
  );
}
