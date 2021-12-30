import * as path from 'path';

import gulp from 'gulp';
import fs from 'fs-extra';
import chalk from 'chalk';
import stringify from 'json-stringify-pretty-compact';
import less from 'gulp-less';
import git from 'gulp-git';
import concat from 'gulp-concat';
import yargs from 'yargs';
import webpack from 'webpack';
import BrowserSync from 'browser-sync';

import webpackConfig from './webpack.config.js';

const argv = yargs(process.argv).argv;
const browserSync = BrowserSync.create('watch');

const moduleName = 'fvtt-markdown-editor';
const repoBaseUrl = 'https://github.com/Moerill/';
const rawBaseUrl = 'https://raw.githubusercontent.com/Moerill/';

function getManifest() {
    const json = { root: '' };

    const modulePath = 'module.json';
    const systemPath = 'system.json';

    if (fs.existsSync(modulePath)) {
        json.file = fs.readJSONSync(modulePath);
        json.name = 'module.json';
    } else if (fs.existsSync(systemPath)) {
        json.file = fs.readJSONSync(systemPath);
        json.name = 'system.json';
    } else {
        return;
    }

    return json;
}

/********************/
/*		BUILD		*/
/********************/

/**
 * Build Less
 */
function buildLess() {
    return gulp
        .src('src/less/*.less')
        .pipe(concat('markdown-editor.css'))
        .pipe(less())
        .pipe(gulp.dest('.'))
        .pipe(browserSync.stream());
}

/**
 * Watch for changes for each build step
 */
function buildWatch() {
    const config /* BrowserSync.Options */ = {
        server: false,
        proxy: {
            target: 'localhost:30000',
            ws: true,
        },
        ghostMode: {
            clicks: false,
            scroll: false,
            location: false,
            forms: false,
        },
        browser: 'google-chrome',
        open: false,
    };
    browserSync.init(config);

    gulp.watch('src/**/*.less', { ignoreInitial: false }, buildLess);
    gulp.watch(
        [
            'src/fonts',
            'src/lang',
            'src/templates',
            'src/*.json',
            'src/assets/**/*',
        ],
        { ignoreInitial: false },
        browserSync.reload
    );
    gulp.watch('src/scripts/**/*.js', buildWebpack);
}

function buildWebpack() {
    return new Promise(function (resolve, reject) {
        // @ts-ignore
        webpack(webpackConfig, function (err, stats) {
            if (err) return reject(err);
            if (stats.hasErrors())
                return reject(new Error(stats.compilation.errors.join('\n')));

            browserSync.reload();
            resolve();
        });
    });
}
/*********************/
/*	update manifest  */
/*********************/

/**
 * Update version and URLs in the manifest JSON
 */
function updateManifest(cb) {
    const packageJson = fs.readJSONSync('package.json');
    const config = {
        repository: repoBaseUrl + moduleName,
        rawURL: rawBaseUrl + moduleName,
    },
        manifest = getManifest(),
        rawURL = config.rawURL,
        repoURL = config.repository;

    if (!config) cb(Error(chalk.red('foundryconfig.json not found')));
    if (!manifest) cb(Error(chalk.red('Manifest JSON not found')));
    if (!rawURL || !repoURL)
        cb(
            Error(
                chalk.red(
                    'Repository URLs not configured in foundryconfig.json'
                )
            )
        );

    try {
        // @ts-ignore
        const version = argv.update || argv.u;

        /* Update version */

        const versionMatch = /^(\d{1,}).(\d{1,}).(\d{1,})$/;
        const currentVersion = manifest.file.version;
        let targetVersion = '';

        if (!version) {
            cb(Error('Missing version number'));
        }

        if (versionMatch.test(version)) {
            targetVersion = version;
        } else {
            targetVersion = currentVersion.replace(
                versionMatch,
                (substring, major, minor, patch) => {
                    console.log(
                        substring,
                        Number(major) + 1,
                        Number(minor) + 1,
                        Number(patch) + 1
                    );
                    if (version === 'major') {
                        return `${Number(major) + 1}.0.0`;
                    } else if (version === 'minor') {
                        return `${major}.${Number(minor) + 1}.0`;
                    } else if (version === 'patch') {
                        return `${major}.${minor}.${Number(patch) + 1}`;
                    } else {
                        return '';
                    }
                }
            );
        }

        if (targetVersion === '') {
            return cb(Error(chalk.red('Error: Incorrect version arguments.')));
        }

        if (targetVersion === currentVersion) {
            return cb(
                Error(
                    chalk.red(
                        'Error: Target version is identical to current version.'
                    )
                )
            );
        }
        console.log(`Updating version number to '${targetVersion}'`);

        packageJson.version = targetVersion;
        manifest.file.version = targetVersion;

        /* Update URLs */

        const downloadUrl = `${repoURL}/releases/download/v${manifest.file.version}/v${manifest.file.version}.zip`;
        // const result = `${rawURL}/v${manifest.file.version}/package/${manifest.file.name}-v${manifest.file.version}.zip`;

        manifest.file.url = repoURL;
        manifest.file.manifest = `${rawURL}/master/${manifest.name}`;
        manifest.file.download = downloadUrl;

        const prettyProjectJson = stringify(manifest.file, {
            maxLength: 35,
            indent: '\t',
        });

        fs.writeJSONSync('package.json', packageJson, { spaces: '\t' });
        fs.writeFileSync(
            path.join(manifest.root, manifest.name),
            prettyProjectJson,
            'utf8'
        );

        return cb();
    } catch (err) {
        cb(err);
    }
}

function gitAdd() {
    return gulp.src('.').pipe(git.add());
}

function gitCommit() {
    return gulp.src('./*').pipe(
        git.commit(`v${getManifest().file.version}`, {
            args: '-a',
            disableAppendPaths: true,
        })
    );
}

function gitTag() {
    const manifest = getManifest();
    return git.tag(
        `v${manifest.file.version}`,
        `Updated to ${manifest.file.version}`,
        (err) => {
            if (err) throw err;
        }
    );
}

export const build = gulp.parallel(buildWebpack, buildLess);
export const watch = buildWatch;
export const update = updateManifest;
export const publish = gulp.series(
    update,
    build,
    gulp.series(gitAdd, gitCommit, gitTag)
);
