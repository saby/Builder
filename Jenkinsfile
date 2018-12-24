node ('controls') {
def version = "3.19.100"
def workspace = "/home/sbis/workspace/router_${version}/${BRANCH_NAME}"
    ws (workspace){
        deleteDir()
        checkout([$class: 'GitSCM',
            branches: [[name: "rc-${version}"]],
            doGenerateSubmoduleConfigurations: false,
            extensions: [[
                $class: 'RelativeTargetDirectory',
                relativeTargetDir: "jenkins_pipeline"
                ]],
                submoduleCfg: [],
                userRemoteConfigs: [[
                    credentialsId: CREDENTIAL_ID_GIT,
                    url: 'git@git.sbis.ru:sbis-ci/jenkins_pipeline.git']]
                                    ])
        start = load "./jenkins_pipeline/platforma/branch/JenkinsfileBuilder"
        start.start(version, BRANCH_NAME, env)
    }
}