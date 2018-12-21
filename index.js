
var AWS = require('aws-sdk');
var CfnLambda = require('cfn-lambda');

var ES = new AWS.ES({apiVersion: '2015-01-01'});
var Lambda = new AWS.Lambda({apiVersion: '2015-03-31'});

var Delete = CfnLambda.SDKAlias({
  api: ES,
  method: 'deleteElasticsearchDomain',
  ignoreErrorCodes: [404, 409],
  keys: ['DomainName'],
  returnPhysicalId: getPhysicalId
});

var BoolProperties = [
  'EBSOptions.EBSEnabled',
  'ElasticsearchClusterConfig.DedicatedMasterEnabled',
  'ElasticsearchClusterConfig.ZoneAwarenessEnabled'
];

var NumProperties = [
  'EBSOptions.Iops',
  'EBSOptions.VolumeSize',
  'ElasticsearchClusterConfig.DedicatedMasterCount',
  'ElasticsearchClusterConfig.InstanceCount',
  'SnapshotOptions.AutomatedSnapshotStartHour'
];

var Create = CfnLambda.SDKAlias({
  api: ES,
  method: 'createElasticsearchDomain',
  forceBools: BoolProperties,
  forceNums: NumProperties,
  returnPhysicalId: getPhysicalId
});

var Update = CfnLambda.SDKAlias({
  api: ES,
  method: 'updateElasticsearchDomainConfig',
  forceBools: BoolProperties,
  forceNums: NumProperties,
  returnPhysicalId: getPhysicalId
});

function getPhysicalId(data, params) {
  return params.DomainName;
}

exports.handler = CfnLambda({
  Create: Create,
  Update: Update,
  Delete: Delete,
  NoUpdate: NoUpdate,
  TriggersReplacement: ['DomainName'],
  SchemaPath: [__dirname, 'schema.json'],
  LongRunning: {
    PingInSeconds: 60,
    MaxPings: 30,
    LambdaApi: Lambda,
    Methods: {
      Create: CheckCreate,
      Update: CheckUpdate,
      Delete: CheckDelete
    }
  }
});

function CheckProcessComplete(params, reply, notDone) {
  ES.describeElasticsearchDomain({
    DomainName: params.DomainName
  }, function(err, domain) {
    if (err) {
      console.error('Error when pinging for Processing Complete: %j', err);
      return reply(err.message);
    }
    if (domain.DomainStatus.Processing || !domain.DomainStatus.Endpoint) {
      console.log('Status is not Processing: false yet. Ping not done: %j', domain);
      return notDone();
    }
    console.log('Status is Processing: false! %j', domain);
    // NOTE: we are using the response from describeElasticsearchDomain here instead of 
    // the DomainName passed through CR params, as getPhysicalId does
    // this is what is responsible for returning the CR's physical ID on creation,
    //  used by references in CFN.
    // TODO: to make the returnPhysicalId key usage in SDKAlias be intuitive,
    // test this with Params.DomainName and change if it works
    reply(null, domain.DomainStatus.DomainName, {
      Endpoint: domain.DomainStatus.Endpoint
    });
  });
}

function CheckCreate(createReponse, params, reply, notDone) {
  CheckProcessComplete(params, reply, notDone);
}

function CheckUpdate(updateResponse, physicalId, params, oldParams, reply, notDone) {
  CheckProcessComplete(params, reply, notDone);
}

function CheckDelete(deleteResponse, physicalId, params, reply, notDone) {
  ES.describeElasticsearchDomain({
    DomainName: params.DomainName
  }, function(err, domain) {
    if (err && (err.statusCode === 404 || err.statusCode === 409)) {
      console.log('Got a 404 on delete check, implicit Delete SUCCESS: %j', err);
      return reply(null, physicalId);
    }
    if (err) {
      console.error('Error when pinging for Delete Complete: %j', err);
      return reply(err.message);
    }
    if (domain.DomainStatus.Processing) {
      console.log('Status is not Deleted yet. Ping not done: %j', domain);
      return notDone();
    }
    console.log('Status is Deleted! %j', domain);
    reply(null, domain.DomainStatus.DomainId);
  });
}

function NoUpdate(phys, params, reply) {
  ES.describeElasticsearchDomain({
    DomainName: params.DomainName
  }, function(err, domain) {
    if (err) {
      console.error('Error when pinging for NoUpdate Attrs: %j', err);
      return reply(err.message);
    }
    console.log('NoUpdate pingcheck success! %j', domain);
    reply(null, domain.DomainStatus.DomainId, {
      Endpoint: domain.DomainStatus.Endpoint
    });
  });
}
