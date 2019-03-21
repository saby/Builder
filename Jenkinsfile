node ('controls') {
def version = "19.300"
def workspace = "/home/sbis/workspace/builder_${version}/${BRANCH_NAME}"
    ws (workspace){
        deleteDir()
        checkout([$class: 'GitSCM',
            branches: [[name: "19.300/pea/add_browser_smoke"]],
            doGenerateSubmoduleConfigurations: false,
            extensions: [[
                $class: 'RelativeTargetDirectory',
                relativeTargetDir: "jenkins_pipeline"
                ]],
                submoduleCfg: [],
                userRemoteConfigs: [[
                    credentialsId: CREDENTIAL_ID_GIT,
                    url: "${GIT}:sbis-ci/jenkins_pipeline.git"]]
                                    ])
        helper = load "./jenkins_pipeline/platforma/branch/helper"
        start = load "./jenkins_pipeline/platforma/branch/JenkinsfileBuilder"
        start.start(version, workspace, helper)
    }
}