#!/usr/bin/env bash
set -eo pipefail

# http://stackoverflow.com/questions/1593051/how-to-programmatically-determine-the-current-checked-out-git-branch
checkOnMaster() {
  local branch_name
  branch_name="$(git symbolic-ref HEAD 2>/dev/null)"
  if [ "${branch_name}" = "refs/heads/master" ]; then
    echo "On master. Good to go."
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
    echo "Local branch up to date with master. Proceeding.."
  elif [ "$mine" = "$base" ]; then
    echo "Local not up to date. Need to pull."
    read -rsp $'Press any key to continue... or CTRL+C to exit\n' -n1
  elif [ "$remote" = "$base" ]; then
    echo "Local is ahead of remote. Need to push."
    exit 1
  else
    echo "Local diverged from remote"
    exit 1
  fi
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
  echo "Pushing commit and tags..."
  git push --follow-tags
}

main() {
  checkOnMaster
  syncAndCheckWithRemote
  unitTest
  versionCommitAndTag "$1"
  pushCommitandTags
}

main "$@"
