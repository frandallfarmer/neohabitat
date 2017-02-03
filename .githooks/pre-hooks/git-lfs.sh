#!/usr/bin/env bash

set -e

BINARY_FILES=""
CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
LFS_FILES=$(echo $CHANGED_FILES | xargs git check-attr filter | grep 'filter: lfs$' | sed -e 's/: filter: lfs//')

for FILE in $LFS_FILES; do
  SOFT_SHA=$(git hash-object -w $FILE)
  RAW_SHA=$(git hash-object -w --no-filters $FILE)

  if [ $SOFT_SHA == $RAW_SHA ]; then
    BINARY_FILES="$FILE\n$BINARY_FILES"
  fi
done

if [[ -n "$BINARY_FILES" ]]; then
  echo "Attention!"
  echo "----------"
  echo "You tried to commit binary files:"
  echo -e "\x1B[31m$BINARY_FILES\x1B[0m"
  echo "Revert your changes and commit those files with git-lfs!"
  echo "----------"
  exit 1
fi
