#!/usr/bin/env bash

# http://www.tldp.org/LDP/abs/html/options.html
set -eo pipefail

# http://stackoverflow.com/questions/1593051/how-to-programmatically-determine-the-current-checked-out-git-branch
checkOnMaster() {
  local branch_name
  branch_name="$(git symbolic-ref HEAD 2>/dev/null)"
  if [ "${branch_name}" = "refs/heads/master" ]; then
    printf "On master. Good to go.\n\n"
  else
    echo "Need to be on master to proceed."
    exit 1
  fi
}

# http://stackoverflow.com/questions/3258243/check-if-pull-needed-in-git
syncAndCheckWithRemote() {
  echo "Checking local is up to date with remote..."
  git remote update
  local mine
  local remote
  local base
  mine="$(git rev-parse @)"
  remote="$(git rev-parse "@{u}")"
  base="$(git merge-base @ "@{u}")"

  if [ "$mine" = "$remote" ]; then
    printf "Local branch up to date with master. Proceeding..\n\n"
  elif [ "$mine" = "$base" ]; then
    printf "Local not up to date. Need to pull.\n\n"
    read -rsp $'Press any key to continue... or CTRL+C to exit\n\n' -n1
  elif [ "$remote" = "$base" ]; then
    printf "Local is ahead of remote. Need to push.\n\n"
    exit 1
  else
    printf "Local diverged from remote\n\n"
    exit 1
  fi
}

checkChangesSinceCurrentVersion() {
  local currentVersion
  local changes
  currentVersion=$(npm ls --depth=-1 2>/dev/null | head -1 | cut -f 1 -d " " | sed 's/.*@//')
  changes=$(git --no-pager log v"$currentVersion".. --oneline --no-merges --reverse)

  printf "These are the changes since the last version\n\n"
  printf "%s\n\n" "$changes"
  read -rsp $'Press any key to continue... or CTRL+C to exit\n\n' -n1
}

unitTest() {
  npm test
}

# https://docs.npmjs.com/cli/version
versionCommitAndTag() {
  echo "Updating package.json..."
  local version=$1
  case "$version" in
    major)
      npm version major
      ;;
    minor)
      npm version minor
      ;;
    patch)
      npm version patch
      ;;
    *)
      echo "Usage npm run bump {major|minor|patch}"
      exit 1
  esac
}

pushCommitandTags() {
  printf "Pushing commit and tags...\n\n"
  git push --follow-tags
}

main() {
  checkOnMaster
  syncAndCheckWithRemote
  checkChangesSinceCurrentVersion
  unitTest
  versionCommitAndTag "$1"
  pushCommitandTags
}

main "$@"
