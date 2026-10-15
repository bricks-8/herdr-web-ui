### Fixed
- A file named without its folders now opens in a repository that also holds a large data set:
  the lookup reads the git file list first, before a folder walk that stopped at 5,000 entries.
